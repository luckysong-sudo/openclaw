#!/usr/bin/env node

/**
 * Web Terminal Server
 * 提供一个 Web 终端界面，通过 API 执行 shell 命令
 */

import { spawn } from 'child_process';
import { createServer } from 'http';

const PORT = parseInt(process.env.WEB_TERMINAL_PORT || '10001', 10);
const TERMINAL_AUTH_TOKEN = process.env.WEB_TERMINAL_AUTH_TOKEN || 'terminal-admin-2024';

// 简单命令白名单（安全考虑）
const ALLOWED_COMMANDS = [
  'ls', 'll', 'cat', 'head', 'tail', 'wc', 'grep', 'find',
  'ps', 'top', 'htop', 'free', 'df', 'uptime', 'uname',
  'curl', 'wget', 'ping', 'netstat', 'ss',
  'node', 'npm', 'python', 'python3', 'pip', 'pip3',
  'git', 'echo', 'date', 'whoami', 'env', 'printenv',
  'touch', 'mkdir', 'rm', 'cp', 'mv', 'ln',
  'tar', 'gzip', 'gunzip', 'unzip',
  'jq', 'xml', 'sed', 'awk',
];

/**
 * 检查命令是否安全
 */
function isCommandSafe(cmd) {
  // 防止命令注入
  if (/[;&$`|\\(){}!<>]/.test(cmd)) {
    return false;
  }
  
  const parts = cmd.trim().split(/\s+/);
  const commandName = parts[0];
  
  // 检查是否在白名单中
  return ALLOWED_COMMANDS.includes(commandName);
}

/**
 * 执行命令
 */
function executeCommand(cmd, cwd) {
  if (cwd === void 0) { cwd = '/tmp/openclaw'; }
  return new Promise(function(resolve, reject) {
    var parts = cmd.trim().split(/\s+/);
    var command = parts[0];
    var args = parts.slice(1);
    
    try {
      var proc = spawn(command, args, {
        cwd: cwd,
        timeout: 30000, // 30 秒超时
        maxBuffer: 1024 * 1024 * 5, // 5MB 输出限制
      });
      
      var stdout = '';
      var stderr = '';
      
      proc.stdout.on('data', function(data) {
        stdout += data.toString();
      });
      
      proc.stderr.on('data', function(data) {
        stderr += data.toString();
      });
      
      proc.on('close', function(code) {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          code: code,
          success: code === 0,
        });
      });
      
      proc.on('error', function(err) {
        reject(new Error('执行失败: ' + err.message));
      });
      
      // 超时处理
      setTimeout(function() {
        proc.kill('SIGTERM');
        reject(new Error('命令执行超时 (30s)'));
      }, 30000);
      
    } catch (err) {
      reject(new Error('无法执行命令: ' + err.message));
    }
  });
}

/**
 * 创建 HTTP 服务器
 */
var server = createServer(function(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // 处理 OPTIONS 预检请求
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  // 路由处理
  var url = new URL(req.url, 'http://' + req.headers.host);
  
  // 首页 - Web Terminal
  if (url.pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getTerminalHTML());
    return;
  }
  
  // API: 执行命令
  if (url.pathname === '/api/exec' && req.method === 'POST') {
    var body = '';
    req.on('data', function(chunk) { body += chunk; });
    req.on('end', function() {
      executeCommandAPI(JSON.parse(body), res);
    });
    return;
  }
  
  // API: 列出允许的命令
  if (url.pathname === '/api/commands' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ commands: ALLOWED_COMMANDS }));
    return;
  }
  
  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

/**
 * 执行命令 API 处理
 */
function executeCommandAPI(data, res) {
  var command = data.command;
  var directory = data.directory;
  
  if (!command) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '缺少命令参数' }));
    return;
  }
  
  // 安全检查
  if (!isCommandSafe(command)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      error: '命令不安全或不在白名单中',
      safe: false 
    }));
    return;
  }
  
  executeCommand(command, directory || '/tmp/openclaw').then(function(result) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  }).catch(function(err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  });
}

/**
 * Web Terminal HTML
 */
function getTerminalHTML() {
  return '<!DOCTYPE html>\n' +
'<html lang="zh-CN">\n' +
'<head>\n' +
'  <meta charset="UTF-8">\n' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'  <title>OpenClaw Web Terminal</title>\n' +
'  <style>\n' +
'    * { margin: 0; padding: 0; box-sizing: border-box; }\n' +
'    body {\n' +
'      font-family: \'Courier New\', monospace;\n' +
'      background: #0a0a0a;\n' +
'      color: #00ff00;\n' +
'      height: 100vh;\n' +
'      display: flex;\n' +
'      flex-direction: column;\n' +
'    }\n' +
'    header {\n' +
'      background: #1a1a1a;\n' +
'      padding: 10px 20px;\n' +
'      border-bottom: 1px solid #333;\n' +
'      display: flex;\n' +
'      justify-content: space-between;\n' +
'      align-items: center;\n' +
'    }\n' +
'    header h1 { font-size: 16px; color: #00ff00; }\n' +
'    .status { font-size: 12px; color: #888; }\n' +
'    .status.connected { color: #00ff00; }\n' +
'    #terminal-container {\n' +
'      flex: 1;\n' +
'      padding: 10px;\n' +
'      overflow-y: auto;\n' +
'      background: #000;\n' +
'    }\n' +
'    #terminal {\n' +
'      white-space: pre-wrap;\n' +
'      word-break: break-all;\n' +
'    }\n' +
'    .output-line { color: #ccc; margin: 2px 0; }\n' +
'    .error-line { color: #ff4444; margin: 2px 0; }\n' +
'    .success-line { color: #00ff00; margin: 2px 0; }\n' +
'    #input-line {\n' +
'      display: flex;\n' +
'      background: #1a1a1a;\n' +
'      padding: 10px 20px;\n' +
'      border-top: 1px solid #333;\n' +
'    }\n' +
'    #prompt { color: #00ff00; margin-right: 10px; }\n' +
'    #command-input {\n' +
'      flex: 1;\n' +
'      background: transparent;\n' +
'      border: none;\n' +
'      color: #00ff00;\n' +
'      font-family: \'Courier New\', monospace;\n' +
'      font-size: 14px;\n' +
'      outline: none;\n' +
'    }\n' +
'    .loading { color: #ffff00; }\n' +
'  </style>\n' +
'</head>\n' +
'<body>\n' +
'  <header>\n' +
'    <h1>OpenClaw Web Terminal</h1>\n' +
'    <span class="status connected" id="status">Online</span>\n' +
'  </header>\n' +
'  \n' +
'  <div id="terminal-container">\n' +
'    <div id="terminal">\n' +
'      <div class="output-line">Welcome to OpenClaw Web Terminal</div>\n' +
'      <div class="output-line">Type a command to execute, or "help" for allowed commands</div>\n' +
'      <div class="output-line">---</div>\n' +
'    </div>\n' +
'  </div>\n' +
'  \n' +
'  <div id="input-line">\n' +
'    <span id="prompt">openclaw@server:~/tmp/openclaw$</span>\n' +
'    <input type="text" id="command-input" autocomplete="off" autofocus>\n' +
'  </div>\n' +
'\n' +
'  <script>\n' +
'    var terminal = document.getElementById("terminal");\n' +
'    var input = document.getElementById("command-input");\n' +
'    var statusEl = document.getElementById("status");\n' +
'    var history = [];\n' +
'    var historyIndex = -1;\n' +
'    var allowedCommands = [];\n' +
'\n' +
'    function addLine(text, className) {\n' +
'      if (!className) className = "output-line";\n' +
'      var div = document.createElement("div");\n' +
'      div.className = className;\n' +
'      div.textContent = text;\n' +
'      terminal.appendChild(div);\n' +
'      scrollToBottom();\n' +
'    }\n' +
'\n' +
'    function scrollToBottom() {\n' +
'      var container = document.getElementById("terminal-container");\n' +
'      container.scrollTop = container.scrollHeight;\n' +
'    }\n' +
'\n' +
'    function runCommand(cmd) {\n' +
'      addLine("openclaw@server: " + cmd, "success-line");\n' +
'      fetch("/api/exec", {\n' +
'        method: "POST",\n' +
'        headers: { "Content-Type": "application/json" },\n' +
'        body: JSON.stringify({ command: cmd }),\n' +
'      }).then(function(r) { return r.json(); }).then(function(result) {\n' +
'        if (result.error) {\n' +
'          addLine(result.error, "error-line");\n' +
'        } else {\n' +
'          if (result.stdout) addLine(result.stdout);\n' +
'          if (result.stderr) addLine(result.stderr, "error-line");\n' +
'          if (!result.stdout && !result.stderr) {\n' +
'            addLine("(Command executed successfully, no output)");\n' +
'          }\n' +
'        }\n' +
'      }).catch(function(err) {\n' +
'        addLine("Request failed: " + err.message, "error-line");\n' +
'      });\n' +
'      addLine("---");\n' +
'    }\n' +
'\n' +
'    input.addEventListener("keydown", function(e) {\n' +
'      if (e.key === "Enter") {\n' +
'        var cmd = input.value.trim();\n' +
'        if (cmd) {\n' +
'          history.push(cmd);\n' +
'          historyIndex = history.length;\n' +
'          if (cmd === "help") {\n' +
'            addLine("Allowed commands:");\n' +
'            addLine(allowedCommands.join(", ") || "Loading...");\n' +
'            addLine("");\n' +
'            addLine("Note: Only whitelisted commands can be executed for security.");\n' +
'          } else if (cmd === "clear") {\n' +
'            terminal.innerHTML = "";' +
'          } else {\n' +
'            runCommand(cmd);\n' +
'          }\n' +
'        }\n' +
'        input.value = "";\n' +
'      } else if (e.key === "ArrowUp") {\n' +
'        if (historyIndex > 0) {\n' +
'          historyIndex--;\n' +
'          input.value = history[historyIndex];\n' +
'        }\n' +
'        e.preventDefault();\n' +
'      } else if (e.key === "ArrowDown") {\n' +
'        if (historyIndex < history.length - 1) {\n' +
'          historyIndex++;\n' +
'          input.value = history[historyIndex];\n' +
'        } else {\n' +
'          historyIndex = history.length;\n' +
'          input.value = "";\n' +
'        }\n' +
'        e.preventDefault();\n' +
'      }\n' +
'    });\n' +
'\n' +
'    // Fetch allowed commands list\n' +
'    fetch("/api/commands")\n' +
'      .then(function(r) { return r.json(); })\n' +
'      .then(function(data) {\n' +
'        allowedCommands = data.commands || [];\n' +
'      })\n' +
'      .catch(function() {});\n' +
'\n' +
'    input.focus();\n' +
'  </script>\n' +
'</body>\n' +
'</html>';
}

// 启动服务器
server.listen(PORT, '0.0.0.0', function() {
  console.log('Web Terminal running on http://0.0.0.0:' + PORT);
  console.log('   Access: http://localhost:' + PORT);
});