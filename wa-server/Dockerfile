FROM wppconnect/wppconnect-server:latest

# WPPConnect Server - usa Puppeteer/Chromium na porta 21465
ENV SECRET_KEY=StackOS2024WPP
ENV HOST=0.0.0.0
ENV PORT=21465
ENV CUSTOM_USER_DATA_DIR=/data/userDataDir/
ENV TOKEN_STORE_TYPE=file

# Criar diretório de dados persistente (montado via volume no fly.toml)
RUN mkdir -p /data/userDataDir

EXPOSE 21465
