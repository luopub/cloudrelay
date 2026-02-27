import asyncio
import os
import websockets
import json
import logging
import aiohttp
import uuid
from typing import Optional

CLOUD_SERVER_IP = os.environ.get('CLOUD_SERVER_IP') or '127.0.0.1'
CLOUD_SERVER_PORT = int(os.environ.get('CLOUD_SERVER_PORT') or 11000)
LOCAL_SERVER_PORT = int(os.environ.get('LOCAL_SERVER_PORT') or 10999)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class ServerProxy:
    def __init__(self, cloud_server_url: str, target_server: str):
        """
        :param cloud_server_url: 云服务器WebSocket地址 (例如: ws://your-cloud-server:8765)
        :param target_server: 内网服务器地址 (例如: http://localhost:10999)
        """
        self.cloud_server_url = cloud_server_url
        self.target_server = target_server
        self.websocket: Optional[websockets.WebSocketClientProtocol] = None
        self.session: Optional[aiohttp.ClientSession] = None
        
    async def connect_to_cloud(self):
        """连接到云服务器"""
        while True:
            try:
                logger.info(f"正在连接到云服务器: {self.cloud_server_url}")
                async with websockets.connect(
                    self.cloud_server_url,
                    ping_interval=20,
                    ping_timeout=60
                ) as websocket:
                    self.websocket = websocket
                    
                    # 发送服务器标识
                    await websocket.send(json.dumps({
                        'type': 'server'
                    }))
                    
                    logger.info("成功连接到云服务器")
                    
                    # 处理来自云服务器的消息
                    async for message in websocket:
                        await self.handle_cloud_message(message)
                        
            except websockets.exceptions.ConnectionClosed:
                logger.warning("与云服务器的连接断开，尝试重连...")
            except Exception as e:
                logger.error(f"连接错误: {e}")
                
            # 等待5秒后重连
            await asyncio.sleep(5)
    
    async def handle_cloud_message(self, message: str):
        """处理来自云服务器的消息"""
        try:
            data = json.loads(message)
            
            if data.get('type') == 'http_request':
                # 收到HTTP请求，转发给内网服务器
                request_id = data.get('request_id')
                method = data.get('method')
                path = data.get('path')
                headers = data.get('headers', {})
                body = data.get('body')
                
                logger.info(f"收到请求: {method} {path}")
                
                # 发送请求到内网服务器
                try:
                    async with self.get_session() as session:
                        url = f"{self.target_server}{path}"
                        
                        # 准备请求
                        request_kwargs = {
                            'method': method,
                            'url': url,
                            'headers': headers,
                            'timeout': aiohttp.ClientTimeout(total=25)
                        }
                        
                        if method in ['POST', 'PUT', 'PATCH'] and body:
                            request_kwargs['data'] = body
                        
                        async with session.request(**request_kwargs) as response:
                            # 读取响应
                            response_body = await response.text()
                            
                            # 发送响应回云服务器
                            await self.websocket.send(json.dumps({
                                'type': 'http_response',
                                'request_id': request_id,
                                'status': response.status,
                                'headers': dict(response.headers),
                                'body': response_body
                            }))
                            
                except Exception as e:
                    logger.error(f"请求内网服务器失败: {e}")
                    # 发送错误响应
                    await self.websocket.send(json.dumps({
                        'type': 'http_response',
                        'request_id': request_id,
                        'status': 500,
                        'body': f'Internal Server Error: {str(e)}'
                    }))
                    
        except Exception as e:
            logger.error(f"处理云服务器消息失败: {e}")
    
    def get_session(self) -> aiohttp.ClientSession:
        """获取或创建aiohttp会话"""
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession()
        return self.session
    
    async def run(self):
        """运行代理"""
        try:
            await self.connect_to_cloud()
        finally:
            if self.session and not self.session.closed:
                await self.session.close()

async def main():
    # 配置
    CLOUD_SERVER_URL = f"ws://{CLOUD_SERVER_IP}:{CLOUD_SERVER_PORT}"  # 替换为实际的云服务器IP
    TARGET_SERVER = f"http://localhost:{LOCAL_SERVER_PORT}"  # 内网服务器地址
    
    proxy = ServerProxy(CLOUD_SERVER_URL, TARGET_SERVER)
    await proxy.run()

if __name__ == "__main__":
    asyncio.run(main())