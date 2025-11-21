# DeepSeeker 构建指南

## 多平台构建说明

DeepSeeker 使用 Tauri 支持多平台构建，包括 Windows、macOS 和 Linux。

## 前置要求

### 通用要求
- Node.js 16+
- Rust 1.70+
- npm 或 yarn

### Windows
```bash
# 安装 WebView2
# 通常 Windows 10/11 已预装
# 如需手动安装: https://developer.microsoft.com/en-us/microsoft-edge/webview2/
```

### macOS
```bash
# 安装 Xcode Command Line Tools
xcode-select --install
```

### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libssl-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

### Linux (Fedora)
```bash
sudo dnf install \
  webkit2gtk4.1-devel \
  openssl-devel \
  curl \
  wget \
  file \
  libappindicator-gtk3-devel \
  librsvg2-devel
```

## 开发构建

```bash
# 安装依赖
npm install

# 开发模式运行
npm run tauri dev
```

## 生产构建

### Windows
```bash
# 构建 Windows 安装包 (.msi)
npm run tauri build

# 输出位置: src-tauri/target/release/bundle/msi/
```

### macOS
```bash
# 构建 macOS 应用 (.dmg, .app)
npm run tauri build

# 输出位置: src-tauri/target/release/bundle/dmg/
# 和: src-tauri/target/release/bundle/macos/
```

### Linux
```bash
# 构建 Linux 安装包 (.deb, .AppImage)
npm run tauri build

# 输出位置:
# - src-tauri/target/release/bundle/deb/
# - src-tauri/target/release/bundle/appimage/
```

## 构建特定平台

```bash
# 仅构建 .deb (Debian/Ubuntu)
npm run tauri build -- --bundles deb

# 仅构建 .AppImage
npm run tauri build -- --bundles appimage

# 仅构建 .dmg (macOS)
npm run tauri build -- --bundles dmg

# 仅构建 .msi (Windows)
npm run tauri build -- --bundles msi
```

## 自动更新配置

DeepSeeker 集成了 Tauri 的自动更新功能。要启用自动更新:

1. 生成密钥对:
```bash
npm run tauri signer generate -- -w ~/.tauri/deepseeker.key
```

2. 在 `tauri.conf.json` 中配置 `pubkey`:
```json
{
  "plugins": {
    "updater": {
      "pubkey": "YOUR_PUBLIC_KEY_HERE",
      "endpoints": ["https://your-update-server.com/updates/{{target}}/{{current_version}}"]
    }
  }
}
```

3. 发布时签名:
```bash
npm run tauri build
# 签名文件会自动生成在输出目录
```

## 发布清单

构建完成后，生成的文件包括:

### Windows
- `DeepSeeker_1.0.0_x64_en-US.msi` - 安装包
- `DeepSeeker_1.0.0_x64_en-US.msi.zip` - 压缩包
- `DeepSeeker_1.0.0_x64_en-US.msi.zip.sig` - 更新签名

### macOS
- `DeepSeeker.app` - 应用程序
- `DeepSeeker_1.0.0_aarch64.dmg` (Apple Silicon)
- `DeepSeeker_1.0.0_x64.dmg` (Intel)

### Linux
- `deepseeker_1.0.0_amd64.deb` - Debian 包
- `deepseeker_1.0.0_amd64.AppImage` - AppImage 包

## 打包优化

当前配置已启用以下优化:
- `opt-level = "z"` - 最小化二进制大小
- `lto = true` - 链接时优化
- `strip = true` - 移除调试符号
- `codegen-units = 1` - 单个代码生成单元（更好的优化）

典型的发布包大小:
- Windows: ~15-20 MB
- macOS: ~20-25 MB
- Linux: ~15-20 MB

## 故障排除

### Windows: "WebView2 not found"
下载并安装 WebView2 Runtime: https://go.microsoft.com/fwlink/p/?LinkId=2124703

### macOS: "Developer cannot be verified"
```bash
xattr -cr /Applications/DeepSeeker.app
```

### Linux: AppImage 权限错误
```bash
chmod +x deepseeker_1.0.0_amd64.AppImage
```

## CI/CD 集成

示例 GitHub Actions 工作流:

```yaml
name: Release
on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    strategy:
      matrix:
        platform: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: dtolnay/rust-toolchain@stable
      - name: Install dependencies (Ubuntu)
        if: matrix.platform == 'ubuntu-latest'
        run: |
          sudo apt update
          sudo apt install -y libwebkit2gtk-4.1-dev \
            build-essential curl wget file \
            libssl-dev libgtk-3-dev \
            libayatana-appindicator3-dev librsvg2-dev
      - run: npm install
      - run: npm run tauri build
      - uses: softprops/action-gh-release@v1
        with:
          files: src-tauri/target/release/bundle/**/*
```

## 许可证

构建和分发时请确保遵守相关开源许可证要求。
