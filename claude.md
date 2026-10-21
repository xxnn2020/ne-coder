# 项目介绍
本项目是一个AI终端应用项目，该项目运行后可以在终端启动。辅助用户进行开发，类似claude code、codex、trae这样的Agent工具。

# 项目技术栈
1. 使用nodejs配合node的一些库进行开发，请求大模型接口用的是openai。
2. 项目使用js，不使用ts。

# 项目的目录介绍
[./src](项目的代码存放处)
[./src/index.js](项目的启动文件，项目入口文件)
[./src/docs](项目携带给大模型接口的文档模版存放在这里)
[./src/utils](项目用到的一些工具函数存放在这里)
[./src/tools](项目本地用到的一些大模型functiontool存放在这里)

# 项目的额外规范
1. 项目使用的是ESModule规范，而不是CommonJS规范。
2. 项目采用JavaScript开发，而不是TypeScript。
3. 启动后扫码package.json中的包是否安装，如果没有请安装。
4. 每次执行新的需求时，先询问我是否需要做一次代码提交。如果需要先把上一次的需求总结，然后做git提交commit，不需要推送push到远程。再进行需求分析和开发。