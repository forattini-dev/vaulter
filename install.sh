#!/bin/sh
# Vaulter Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/forattini-dev/vaulter/main/install.sh | sh
#
# Environment variables:
#   VAULTER_VERSION  - Specific version to install (default: latest)
#   VAULTER_DIR      - Installation directory (default: ~/.local/bin)

set -e

REPO="forattini-dev/vaulter"
BINARY_NAME="vaulter"

# Colors (disabled if not tty)
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  BLUE='\033[0;34m'
  NC='\033[0m'
else
  RED=''
  GREEN=''
  YELLOW=''
  BLUE=''
  NC=''
fi

info() { printf "${BLUE}info${NC}  %s\n" "$1"; }
success() { printf "${GREEN}success${NC}  %s\n" "$1"; }
warn() { printf "${YELLOW}warn${NC}  %s\n" "$1"; }
error() { printf "${RED}error${NC}  %s\n" "$1" >&2; exit 1; }

# Detect OS
detect_os() {
  case "$(uname -s)" in
    Linux*)  echo "linux" ;;
    Darwin*) echo "macos" ;;
    MINGW*|MSYS*|CYGWIN*) echo "win" ;;
    *) error "Unsupported OS: $(uname -s)" ;;
  esac
}

# Detect architecture
detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "x64" ;;
    aarch64|arm64) echo "arm64" ;;
    *) error "Unsupported architecture: $(uname -m)" ;;
  esac
}

# Get latest version from GitHub
get_latest_version() {
  curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | \
    grep '"tag_name"' | \
    sed -E 's/.*"tag_name": *"([^"]+)".*/\1/'
}

# Main installation
main() {
  OS=$(detect_os)
  ARCH=$(detect_arch)

  info "Detected: ${OS}-${ARCH}"

  # Determine version
  if [ -n "${VAULTER_VERSION}" ]; then
    VERSION="${VAULTER_VERSION}"
  else
    info "Fetching latest version..."
    VERSION=$(get_latest_version)
  fi

  if [ -z "${VERSION}" ]; then
    error "Could not determine version. Set VAULTER_VERSION or check your internet connection."
  fi

  info "Installing vaulter ${VERSION}"

  # Build download URL
  if [ "${OS}" = "win" ]; then
    FILENAME="${BINARY_NAME}-${OS}-${ARCH}.exe"
  else
    FILENAME="${BINARY_NAME}-${OS}-${ARCH}"
  fi

  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${FILENAME}"

  # Determine install directory
  INSTALL_DIR="${VAULTER_DIR:-$HOME/.local/bin}"

  # Create install directory if needed
  if [ ! -d "${INSTALL_DIR}" ]; then
    info "Creating ${INSTALL_DIR}"
    mkdir -p "${INSTALL_DIR}"
  fi

  # Download binary
  INSTALL_PATH="${INSTALL_DIR}/${BINARY_NAME}"

  info "Downloading from ${DOWNLOAD_URL}"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "${DOWNLOAD_URL}" -o "${INSTALL_PATH}"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "${INSTALL_PATH}" "${DOWNLOAD_URL}"
  else
    error "curl or wget is required"
  fi

  # Make executable
  chmod +x "${INSTALL_PATH}"

  # Verify installation
  if [ -x "${INSTALL_PATH}" ]; then
    success "Installed vaulter to ${INSTALL_PATH}"
  else
    error "Installation failed"
  fi

  # Check if install dir is in PATH
  case ":${PATH}:" in
    *":${INSTALL_DIR}:"*) ;;
    *)
      warn "${INSTALL_DIR} is not in your PATH"
      echo ""
      echo "Add it to your shell profile:"
      echo ""
      echo "  # bash (~/.bashrc)"
      echo "  export PATH=\"\${HOME}/.local/bin:\${PATH}\""
      echo ""
      echo "  # zsh (~/.zshrc)"
      echo "  export PATH=\"\${HOME}/.local/bin:\${PATH}\""
      echo ""
      echo "  # fish (~/.config/fish/config.fish)"
      echo "  set -gx PATH \$HOME/.local/bin \$PATH"
      echo ""
      ;;
  esac

  # Show version
  echo ""
  "${INSTALL_PATH}" --version | head -1
  echo ""
  success "Installation complete!"
}

main "$@"
