# 画境工作台

Windows 图像与视频生成桌面工作台。使用者填写自己的 Geeknow API Key；默认接口地址为 `https://www.geeknow.top`。

## 功能

- 图像和视频模型选择、提示词、参考图、画幅比例与 `auto` 自动识别
- 生成结果预览、历史记录、原图保存和图片右键原尺寸复制
- 可连续提交多个任务，并行等待生成；每个任务独立显示进度条
- 双击已生成图片放大预览；提示词输入框可一键展开
- 可确认后清空全部历史任务及未另存的临时文件
- 生成完成两小时后清理本机临时媒体；永久保存的文件不受影响
- Windows 安全存储加密保存 API Key
- 通过 GitHub Releases 检查更新，弹窗展示各版本更新内容，由用户选择何时下载与安装
- 参考图支持点击选择和从桌面、文件夹拖入；双击缩略图可放大查看
- GPT Image 系列带参考图任务先上传素材并通过异步接口提交 URL，显示真实进度
- 浅色／深色模式切换；发现新版本后由用户选择下载及安装
- 网络请求自动读取 Windows 系统代理，也支持 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY` 环境变量
- 兼容返回纯文本 JSON 的 Midjourney 接口，并在升级后恢复曾被误判为失败的已提交任务
- Midjourney 参考图逐张上传后以图片 URL 提交，减少多图生成请求体积；分别显示上传与提交错误
- 上游安全系统拒绝生成时显示说明和请求 ID，方便向 Geeknow 客服反馈
- 使用当前 Electron 剪贴板接口复制图片，保持原始尺寸和逐像素内容

界面提供浅色和深色模式。每位使用者在自己的电脑填写 Key。模型是否可用取决于 Geeknow 账户权限、额度和服务状态。

## 开发和打包

需要 Node.js 和 Python（图标脚本需 Pillow）。

```powershell
npm ci
npm test
npm run dist:win
```

打包输出在 `release/`。管理者发布更新时先修改 `package.json` 的 `version`，再上传安装包、对应的 `.blockmap` 和 `latest.yml` 到同版本 GitHub Release。应用配置为从 `guanchenli79-bit/image-workbench` 检查更新。

详细使用步骤见 [使用说明.txt](使用说明.txt)。
