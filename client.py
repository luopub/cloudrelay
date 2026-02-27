import asyncio
import os
import websockets
import json
import logging
import uuid
from typing import Optional, Dict, Any
import aiohttp
from urllib.parse import urlparse

CLOUD_SERVER_IP = os.environ.get('CLOUD_SERVER_IP') or '127.0.0.1'
CLOUD_SERVER_PORT = int(os.environ.get('CLOUD_SERVER_PORT') or 11000)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class RelayClient:
    def __init__(self, cloud_server_url: str):
        """
        :param cloud_server_url: 云服务器WebSocket地址
        """
        self.cloud_server_url = cloud_server_url
        self.websocket: Optional[websockets.WebSocketClientProtocol] = None
        self.pending_requests: Dict[str, asyncio.Future] = {}
        
    async def connect(self):
        """连接到云服务器"""
        try:
            logger.info(f"正在连接到云服务器: {self.cloud_server_url}")
            self.websocket = await websockets.connect(
                self.cloud_server_url,
                ping_interval=20,
                ping_timeout=60
            )
            
            # 发送客户端标识
            await self.websocket.send(json.dumps({
                'type': 'client'
            }))
            
            logger.info("成功连接到云服务器")
            
        except Exception as e:
            logger.error(f"连接失败: {e}")
            raise
    
    async def send_http_request(self, method: str, path: str, 
                               headers: Optional[Dict] = None, 
                               body: Optional[str] = None) -> Dict[str, Any]:
        """
        发送HTTP请求到内网服务器
        
        :param method: HTTP方法 (GET, POST等)
        :param path: 请求路径 (例如: /api/data)
        :param headers: 请求头
        :param body: 请求体
        :return: 响应
        """
        if not self.websocket:
            raise Exception("未连接到云服务器")
        
        # 生成唯一请求ID
        request_id = str(uuid.uuid4())
        
        # 创建future等待响应
        future = asyncio.Future()
        self.pending_requests[request_id] = future
        
        try:
            # 发送请求到云服务器
            await self.websocket.send(json.dumps({
                'type': 'http_request',
                'request_id': request_id,
                'method': method,
                'path': path,
                'headers': headers or {},
                'body': body
            }))
            
            # 等待响应（设置超时）
            response = await asyncio.wait_for(future, timeout=30)
            return response
            
        except asyncio.TimeoutError:
            self.pending_requests.pop(request_id, None)
            raise Exception("请求超时")
        except Exception as e:
            self.pending_requests.pop(request_id, None)
            raise e
    
    async def listen_for_responses(self):
        """监听来自云服务器的响应"""
        try:
            async for message in self.websocket:
                data = json.loads(message)
                
                if data.get('type') == 'http_response':
                    request_id = data.get('request_id')
                    
                    if request_id in self.pending_requests:
                        future = self.pending_requests.pop(request_id)
                        future.set_result(data)
                        
        except websockets.exceptions.ConnectionClosed:
            logger.warning("与云服务器的连接已关闭")
        except Exception as e:
            logger.error(f"监听响应时出错: {e}")
    
    async def close(self):
        """关闭连接"""
        if self.websocket:
            await self.websocket.close()

async def main():
    # 配置
    CLOUD_SERVER_URL = f"ws://{CLOUD_SERVER_IP}:{CLOUD_SERVER_PORT}"  # 替换为实际的云服务器IP
    
    client = RelayClient(CLOUD_SERVER_URL)
    
    try:
        # 连接到云服务器
        await client.connect()
        
        # 启动响应监听任务
        listen_task = asyncio.create_task(client.listen_for_responses())
        
        # 示例：发送几个请求
        # GET请求示例
        try:
            response = await client.send_http_request('GET', '/api/data')
            print(f"GET响应: 状态={response['status']}")
            print(f"响应体: {response['body']}")
        except Exception as e:
            print(f"GET请求失败: {e}")
        
        # POST请求示例
        try:
            response = await client.send_http_request(
                'POST', 
                '/api/submit',
                headers={'Content-Type': 'application/json'},
                body='{"key": "value"}'
            )
            print(f"POST响应: 状态={response['status']}")
            print(f"响应体: {response['body']}")
        except Exception as e:
            print(f"POST请求失败: {e}")
        
        # 等待一段时间以便接收所有响应
        await asyncio.sleep(5)
        
        # 取消监听任务
        listen_task.cancel()
        
    except Exception as e:
        logger.error(f"程序出错: {e}")
    finally:
        await client.close()

if __name__ == "__main__":
    asyncio.run(main())