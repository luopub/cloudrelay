const net = require('net');
const crypto = require('crypto');
const readline = require('readline');

// 配置
const CLOUD_SERVER_IP = process.env.CLOUD_SERVER_IP || '127.0.0.1';
const CLOUD_SERVER_PORT = process.env.CLOUD_SERVER_PORT || 11000;

/**
 * 简易 WebSocket 客户端（使用 Node.js 内置 net 模块实现）
 */
class SimpleWebSocket {
    constructor(url) {
        this.url = new URL(url);
        this.socket = null;
        this.onOpen = null;
        this.onMessage = null;
        this.onClose = null;
        this.onError = null;
        this.connected = false;
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.socket = net.createConnection({
                host: this.url.hostname,
                port: parseInt(this.url.port) || 80
            });

            const key = crypto.randomBytes(16).toString('base64');

            this.socket.on('connect', () => {
                // 发送 WebSocket 握手
                const handshake = [
                    `GET ${this.url.pathname}${this.url.search} HTTP/1.1`,
                    `Host: ${this.url.hostname}:${this.url.port}`,
                    'Upgrade: websocket',
                    'Connection: Upgrade',
                    `Sec-WebSocket-Key: ${key}`,
                    'Sec-WebSocket-Version: 13',
                    '',
                    ''
                ].join('\r\n');
                this.socket.write(handshake);
            });

            let buffer = Buffer.alloc(0);
            let handshakeDone = false;

            this.socket.on('data', (data) => {
                if (!handshakeDone) {
                    // 检查握手完成
                    const headerEnd = data.indexOf('\r\n\r\n');
                    if (headerEnd !== -1) {
                        handshakeDone = true;
                        this.connected = true;
                        const body = data.slice(headerEnd + 4);
                        if (body.length > 0) {
                            buffer = Buffer.concat([buffer, body]);
                        }
                        if (this.onOpen) this.onOpen();
                        resolve();
                    }
                } else {
                    buffer = Buffer.concat([buffer, data]);
                    this.processBuffer();
                }
            });

            this.socket.on('close', () => {
                this.connected = false;
                if (this.onClose) this.onClose();
            });

            this.socket.on('error', (err) => {
                if (this.onError) this.onError(err);
                reject(err);
            });
        });
    }

    processBuffer() {
        while (this.bufferToFrames().length > 0) {
            const frames = this.bufferToFrames();
            for (const frame of frames) {
                if (this.onMessage) this.onMessage(frame);
            }
        }
    }

    bufferToFrames() {
        // 简化版帧解析，处理文本帧
        // 实际 WebSocket 帧解析比较复杂，这里只处理基本场景
        return [];
    }

    send(data) {
        if (!this.connected) {
            throw new Error('WebSocket is not connected');
        }
        const frame = this.createFrame(Buffer.from(data));
        this.socket.write(frame);
    }

    createFrame(payload) {
        const payloadLength = payload.length;
        let frame;

        if (payloadLength <= 125) {
            frame = Buffer.alloc(2 + payloadLength);
            frame[0] = 0x81; // FIN + Text frame
            frame[1] = payloadLength;
            payload.copy(frame, 2);
        } else if (payloadLength <= 65535) {
            frame = Buffer.alloc(4 + payloadLength);
            frame[0] = 0x81;
            frame[1] = 126;
            frame.writeUInt16BE(payloadLength, 2);
            payload.copy(frame, 4);
        } else {
            frame = Buffer.alloc(10 + payloadLength);
            frame[0] = 0x81;
            frame[1] = 127;
            frame.writeBigUInt64BE(BigInt(payloadLength), 2);
            payload.copy(frame, 10);
        }

        return frame;
    }

    close() {
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
            this.connected = false;
        }
    }
}

/**
 * WebSocket 客户端（支持帧解析的完整实现）
 */
class WebSocketClient {
    constructor(url) {
        this.url = new URL(url);
        this.socket = null;
        this.onOpen = null;
        this.onMessage = null;
        this.onClose = null;
        this.onError = null;
        this.connected = false;
        this.buffer = Buffer.alloc(0);
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.socket = net.createConnection({
                host: this.url.hostname,
                port: parseInt(this.url.port) || 80
            });

            const key = crypto.randomBytes(16).toString('base64');

            this.socket.on('connect', () => {
                const handshake = [
                    `GET ${this.url.pathname || '/'}${this.url.search} HTTP/1.1`,
                    `Host: ${this.url.hostname}:${this.url.port}`,
                    'Upgrade: websocket',
                    'Connection: Upgrade',
                    `Sec-WebSocket-Key: ${key}`,
                    'Sec-WebSocket-Version: 13',
                    '',
                    ''
                ].join('\r\n');
                this.socket.write(handshake);
            });

            let handshakeDone = false;

            this.socket.on('data', (data) => {
                if (!handshakeDone) {
                    const headerEnd = data.indexOf('\r\n\r\n');
                    if (headerEnd !== -1) {
                        handshakeDone = true;
                        this.connected = true;
                        const body = data.slice(headerEnd + 4);
                        if (body.length > 0) {
                            this.buffer = Buffer.concat([this.buffer, body]);
                            this.processFrames();
                        }
                        if (this.onOpen) this.onOpen();
                        resolve();
                    }
                } else {
                    this.buffer = Buffer.concat([this.buffer, data]);
                    this.processFrames();
                }
            });

            this.socket.on('close', () => {
                this.connected = false;
                if (this.onClose) this.onClose();
            });

            this.socket.on('error', (err) => {
                if (this.onError) this.onError(err);
                if (!handshakeDone) reject(err);
            });
        });
    }

    processFrames() {
        while (this.buffer.length >= 2) {
            const fin = (this.buffer[0] & 0x80) !== 0;
            const opcode = this.buffer[0] & 0x0f;
            let masked = (this.buffer[1] & 0x80) !== 0;
            let payloadLength = this.buffer[1] & 0x7f;

            let offset = 2;

            if (payloadLength === 126) {
                if (this.buffer.length < 4) break;
                payloadLength = this.buffer.readUInt16BE(2);
                offset = 4;
            } else if (payloadLength === 127) {
                if (this.buffer.length < 10) break;
                payloadLength = Number(this.buffer.readBigUInt64BE(2));
                offset = 10;
            }

            // 服务器发送的消息不应被掩码
            if (masked) {
                if (this.buffer.length < offset + 4) break;
                offset += 4;
            }

            if (this.buffer.length < offset + payloadLength) break;

            const payload = this.buffer.slice(offset, offset + payloadLength);
            this.buffer = this.buffer.slice(offset + payloadLength);

            // 只处理文本帧和关闭帧
            if (opcode === 0x1 || opcode === 0x0) { // Text frame or continuation
                if (this.onMessage) {
                    this.onMessage(payload.toString('utf8'));
                }
            } else if (opcode === 0x8) { // Close frame
                this.close();
                break;
            }
        }
    }

    send(data) {
        if (!this.connected) {
            throw new Error('WebSocket is not connected');
        }
        const payload = Buffer.from(data, 'utf8');
        const frame = this.createFrame(payload, true);
        this.socket.write(frame);
    }

    createFrame(payload, mask = true) {
        const payloadLength = payload.length;
        let maskKey = mask ? crypto.randomBytes(4) : null;
        let frame;

        let headerLength = 2;
        if (payloadLength <= 125) {
            headerLength = 2;
        } else if (payloadLength <= 65535) {
            headerLength = 4;
        } else {
            headerLength = 10;
        }

        if (mask) headerLength += 4;

        frame = Buffer.alloc(headerLength + payloadLength);

        frame[0] = 0x81; // FIN + Text frame

        if (payloadLength <= 125) {
            frame[1] = mask ? (payloadLength | 0x80) : payloadLength;
            let offset = 2;
            if (mask) {
                maskKey.copy(frame, offset);
                offset += 4;
            }
            for (let i = 0; i < payloadLength; i++) {
                frame[offset + i] = payload[i] ^ maskKey[i % 4];
            }
        } else if (payloadLength <= 65535) {
            frame[1] = mask ? 0xfe : 126;
            frame.writeUInt16BE(payloadLength, 2);
            let offset = 4;
            if (mask) {
                maskKey.copy(frame, offset);
                offset += 4;
            }
            for (let i = 0; i < payloadLength; i++) {
                frame[offset + i] = payload[i] ^ maskKey[i % 4];
            }
        } else {
            frame[1] = mask ? 0xff : 127;
            frame.writeBigUInt64BE(BigInt(payloadLength), 2);
            let offset = 10;
            if (mask) {
                maskKey.copy(frame, offset);
                offset += 4;
            }
            for (let i = 0; i < payloadLength; i++) {
                frame[offset + i] = payload[i] ^ maskKey[i % 4];
            }
        }

        return frame;
    }

    close() {
        if (this.socket) {
            if (this.connected) {
                // 发送关闭帧
                const closeFrame = Buffer.from([0x88, 0x00]);
                try {
                    this.socket.write(closeFrame);
                } catch (e) {}
            }
            this.socket.destroy();
            this.socket = null;
            this.connected = false;
        }
    }
}

/**
 * RelayClient - 独立的收发客户端类
 * 封装了与云服务器的 WebSocket 通信逻辑，与测试数据无关
 */
class RelayClient {
    /**
     * @param {string} cloudServerUrl - 云服务器 WebSocket 地址
     */
    constructor(cloudServerUrl) {
        this.cloudServerUrl = cloudServerUrl;
        this.websocket = null;
        this.pendingRequests = new Map();
    }

    /**
     * 连接到云服务器
     * @returns {Promise<void>}
     */
    async connect() {
        console.log(`正在连接到云服务器: ${this.cloudServerUrl}`);
        
        this.websocket = new WebSocketClient(this.cloudServerUrl);

        this.websocket.onMessage = (data) => {
            this.handleMessage(data);
        };

        this.websocket.onClose = () => {
            console.log('与云服务器的连接已关闭');
        };

        this.websocket.onError = (error) => {
            console.error('WebSocket 错误:', error.message);
        };

        await this.websocket.connect();

        // 发送客户端标识
        this.websocket.send(JSON.stringify({
            type: 'client'
        }));

        console.log('成功连接到云服务器');
    }

    /**
     * 处理接收到的消息
     * @param {string} data - 接收到的数据
     */
    handleMessage(data) {
        try {
            const parsed = JSON.parse(data);

            if (parsed.type === 'http_response') {
                const requestId = parsed.request_id;

                if (this.pendingRequests.has(requestId)) {
                    const { resolve } = this.pendingRequests.get(requestId);
                    this.pendingRequests.delete(requestId);
                    resolve(parsed);
                }
            }
        } catch (error) {
            console.error('解析消息时出错:', error);
        }
    }

    /**
     * 发送 HTTP 请求到内网服务器
     * @param {string} method - HTTP 方法 (GET, POST 等)
     * @param {string} path - 请求路径 (例如: /api/data)
     * @param {Object} [headers={}] - 请求头
     * @param {string} [body=null] - 请求体
     * @param {number} [timeout=30000] - 超时时间(毫秒)
     * @returns {Promise<Object>} 响应数据
     */
    sendHttpRequest(method, path, headers = {}, body = null, timeout = 30000) {
        return new Promise((resolve, reject) => {
            if (!this.websocket || !this.websocket.connected) {
                reject(new Error('未连接到云服务器'));
                return;
            }

            // 生成唯一请求 ID
            const requestId = this.generateRequestId();

            // 设置超时
            const timeoutId = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error('请求超时'));
            }, timeout);

            // 存储请求
            this.pendingRequests.set(requestId, {
                resolve: (response) => {
                    clearTimeout(timeoutId);
                    resolve(response);
                },
                reject: (error) => {
                    clearTimeout(timeoutId);
                    reject(error);
                }
            });

            // 发送请求
            try {
                this.websocket.send(JSON.stringify({
                    type: 'http_request',
                    request_id: requestId,
                    method: method,
                    path: path,
                    headers: headers,
                    body: body
                }));
            } catch (error) {
                this.pendingRequests.delete(requestId);
                clearTimeout(timeoutId);
                reject(error);
            }
        });
    }

    /**
     * 生成唯一请求 ID
     * @returns {string}
     */
    generateRequestId() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * 关闭连接
     */
    close() {
        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }
    }
}

/**
 * 创建独立的收发客户端实例
 * @param {string} cloudServerUrl - 云服务器 WebSocket 地址
 * @returns {RelayClient}
 */
function createRelayClient(cloudServerUrl) {
    return new RelayClient(cloudServerUrl);
}

/**
 * 发送单个 HTTP 请求的便捷函数
 * @param {string} cloudServerUrl - 云服务器 WebSocket 地址
 * @param {string} method - HTTP 方法
 * @param {string} path - 请求路径
 * @param {Object} [options] - 可选参数
 * @param {Object} [options.headers] - 请求头
 * @param {string} [options.body] - 请求体
 * @param {number} [options.timeout] - 超时时间(毫秒)
 * @returns {Promise<Object>} 响应数据
 */
async function sendRequest(cloudServerUrl, method, path, options = {}) {
    const client = new RelayClient(cloudServerUrl);
    try {
        await client.connect();
        const response = await client.sendHttpRequest(
            method,
            path,
            options.headers || {},
            options.body || null,
            options.timeout || 30000
        );
        return response;
    } finally {
        client.close();
    }
}

/**
 * 交互式测试客户端
 */
async function interactiveClient() {
    const CLOUD_SERVER_URL = `ws://${CLOUD_SERVER_IP}:${CLOUD_SERVER_PORT}`;
    const client = new RelayClient(CLOUD_SERVER_URL);

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const question = (prompt) => new Promise((resolve) => {
        rl.question(prompt, resolve);
    });

    try {
        await client.connect();

        console.log('简单测试客户端已启动');
        console.log('可用命令:');
        console.log('  get <path>           - 发送GET请求');
        console.log('  post <path> <data>   - 发送POST请求');
        console.log('  quit                 - 退出');
        console.log();

        while (true) {
            try {
                const command = await question('> ');

                if (command.toLowerCase() === 'quit') {
                    break;
                }

                const parts = command.split(/\s+/);
                if (!parts[0]) continue;

                const cmd = parts[0].toLowerCase();

                if (cmd === 'get' && parts.length >= 2) {
                    const path = parts[1];
                    console.log(`发送GET请求到 ${path}`);

                    const response = await client.sendHttpRequest('GET', path);
                    console.log(`状态码: ${response.status}`);
                    console.log(`响应体: ${response.body ? response.body.substring(0, 200) : ''}`);

                } else if (cmd === 'post' && parts.length >= 3) {
                    const path = parts[1];
                    const data = parts.slice(2).join(' ');
                    console.log(`发送POST请求到 ${path} 数据: ${data}`);

                    const response = await client.sendHttpRequest(
                        'POST',
                        path,
                        { 'Content-Type': 'application/json' },
                        data
                    );
                    console.log(`状态码: ${response.status}`);
                    console.log(`响应体: ${response.body ? response.body.substring(0, 200) : ''}`);

                } else {
                    console.log('无效命令');
                }

            } catch (error) {
                console.log(`请求失败: ${error.message}`);
            }
        }

    } catch (error) {
        console.log(`程序出错: ${error.message}`);
    } finally {
        rl.close();
        client.close();
    }
}

// 导出模块
module.exports = {
    RelayClient,
    createRelayClient,
    sendRequest
};

// 如果直接运行此文件，启动交互式客户端
if (require.main === module) {
    interactiveClient().catch(console.error);
}
