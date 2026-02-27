import asyncio
import os
import websockets
import json
import logging
from typing import Dict, Optional
import aiohttp
from urllib.parse import urlparse, parse_qs

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

CLOUD_SERVER_PORT = int(os.environ.get('CLOUD_SERVER_PORT') or 11000)

class CloudRelayServer:
    def __init__(self):
        # 存储服务器连接
        self.server_connection: Optional[websockets.WebSocketServerProtocol] = None
        # 存储等待响应的客户端请求
        self.pending_requests: Dict[str, asyncio.Future] = {}
        
    async def handle_connection(self, websocket):
        """处理新的WebSocket连接"""
        try:
            # 接收初始消息来确定是服务器还是客户端
            init_message = await websocket.recv()
            data = json.loads(init_message)
            
            if data.get('type') == 'server':
                logger.info("服务器已连接")
                self.server_connection = websocket
                await self.handle_server(websocket)
            elif data.get('type') == 'client':
                logger.info("客户端已连接")
                await self.handle_client(websocket)
            else:
                logger.warning(f"未知的连接类型: {data.get('type')}")
                
        except websockets.exceptions.ConnectionClosed:
            logger.info("连接关闭")
        except Exception as e:
            logger.error(f"处理连接时出错: {e}")
        finally:
            # 清理断开的连接
            if websocket == self.server_connection:
                self.server_connection = None
                logger.info("服务器连接已断开")
    
    async def handle_server(self, websocket):
        """处理服务器连接"""
        try:
            async for message in websocket:
                data = json.loads(message)
                request_id = data.get('request_id')
                
                # 将服务器的响应转发给等待的客户端
                if request_id in self.pending_requests:
                    future = self.pending_requests.pop(request_id)
                    future.set_result(data)
                    
        except websockets.exceptions.ConnectionClosed:
            pass
    
    async def handle_client(self, websocket):
        """处理客户端连接"""
        try:
            async for message in websocket:
                data = json.loads(message)
                
                if data.get('type') == 'http_request':
                    # 客户端发送HTTP请求
                    request_id = data.get('request_id')
                    
                    # 创建future来等待服务器响应
                    future = asyncio.Future()
                    self.pending_requests[request_id] = future
                    
                    # 转发请求到服务器
                    if self.server_connection:
                        await self.server_connection.send(json.dumps({
                            'type': 'http_request',
                            'request_id': request_id,
                            'method': data.get('method'),
                            'path': data.get('path'),
                            'headers': data.get('headers', {}),
                            'body': data.get('body')
                        }))
                        
                        # 等待服务器响应（设置超时）
                        try:
                            response = await asyncio.wait_for(future, timeout=30)
                            # 将响应发送回客户端
                            await websocket.send(json.dumps({
                                'type': 'http_response',
                                'request_id': request_id,
                                'status': response.get('status'),
                                'headers': response.get('headers', {}),
                                'body': response.get('body')
                            }))
                        except asyncio.TimeoutError:
                            # 请求超时
                            self.pending_requests.pop(request_id, None)
                            await websocket.send(json.dumps({
                                'type': 'http_response',
                                'request_id': request_id,
                                'status': 504,
                                'body': 'Gateway Timeout'
                            }))
                    else:
                        # 服务器未连接
                        await websocket.send(json.dumps({
                            'type': 'http_response',
                            'request_id': request_id,
                            'status': 503,
                            'body': 'Server not available'
                        }))
                        
        except websockets.exceptions.ConnectionClosed:
            pass

async def main():
    relay_server = CloudRelayServer()
    
    # 启动WebSocket服务器
    async with websockets.serve(
        relay_server.handle_connection, 
        "0.0.0.0",  # 监听所有接口
        CLOUD_SERVER_PORT,       # WebSocket端口
        ping_interval=20,
        ping_timeout=60
    ):
        logger.info("云中转服务器启动在 ws://0.0.0.0:8765")
        await asyncio.Future()  # 运行 forever

if __name__ == "__main__":
    asyncio.run(main())