import asyncio
import os
import sys
from client import RelayClient

CLOUD_SERVER_IP = os.environ.get('CLOUD_SERVER_IP') or '127.0.0.1'
CLOUD_SERVER_PORT = int(os.environ.get('CLOUD_SERVER_PORT') or 11000)

async def interactive_client():
    """交互式测试客户端"""
    CLOUD_SERVER_URL = f"ws://{CLOUD_SERVER_IP}:{CLOUD_SERVER_PORT}"  # 替换为实际的云服务器IP
    
    client = RelayClient(CLOUD_SERVER_URL)
    
    try:
        # 连接到云服务器
        await client.connect()
        
        # 启动响应监听任务
        listen_task = asyncio.create_task(client.listen_for_responses())
        
        print("简单测试客户端已启动")
        print("可用命令:")
        print("  get <path>           - 发送GET请求")
        print("  post <path> <data>   - 发送POST请求")
        print("  quit                 - 退出")
        print()
        
        while True:
            try:
                # 获取用户输入
                command = await asyncio.get_event_loop().run_in_executor(
                    None, input, "> "
                )
                
                if command.lower() == 'quit':
                    break
                    
                parts = command.split(maxsplit=2)
                if not parts:
                    continue
                    
                cmd = parts[0].lower()
                
                if cmd == 'get' and len(parts) >= 2:
                    path = parts[1]
                    print(f"发送GET请求到 {path}")
                    
                    response = await client.send_http_request('GET', path)
                    print(f"状态码: {response['status']}")
                    print(f"响应体: {response['body'][:200]}")  # 只显示前200字符
                    
                elif cmd == 'post' and len(parts) >= 3:
                    path = parts[1]
                    data = parts[2]
                    print(f"发送POST请求到 {path} 数据: {data}")
                    
                    response = await client.send_http_request(
                        'POST', 
                        path,
                        headers={'Content-Type': 'application/json'},
                        body=data
                    )
                    print(f"状态码: {response['status']}")
                    print(f"响应体: {response['body'][:200]}")
                    
                else:
                    print("无效命令")
                    
            except Exception as e:
                print(f"请求失败: {e}")
                
        # 取消监听任务
        listen_task.cancel()
        
    except Exception as e:
        print(f"程序出错: {e}")
    finally:
        await client.close()

if __name__ == "__main__":
    asyncio.run(interactive_client())