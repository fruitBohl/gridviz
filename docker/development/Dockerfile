FROM oven/bun:1

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    openssh-client \
    postgresql-client \
    sudo \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# AWS CLI v2 (official zip; uname -m gives x86_64 or aarch64, matching the zip names)
RUN curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o /tmp/awscliv2.zip \
    && unzip -q /tmp/awscliv2.zip -d /tmp \
    && /tmp/aws/install \
    && rm -rf /tmp/aws /tmp/awscliv2.zip \
    && aws --version

# Passwordless sudo, same as raven
RUN echo 'bun ALL=(root) NOPASSWD:ALL' > /etc/sudoers.d/bun \
    && chmod 0440 /etc/sudoers.d/bun

# Feature install scripts run as bun and need bash (default shell is sh)
RUN chsh -s /bin/bash bun

USER bun

# uv (provides uvx for the aws-mcp server in .mcp.json) and Claude Code, both into ~/.local/bin.
# ~/.claude is pre-created so the claude-home named volume is initialised owned by bun.
# No system Python here, so uv would fetch the newest (3.15), which breaks mcp-proxy-for-aws's deps.
# ponytail: pinned; drop UV_PYTHON once mcp-proxy-for-aws runs on 3.15.
ENV PATH="/home/bun/.local/bin:${PATH}" \
    UV_PYTHON=3.13
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
    && uv python install 3.13 \
    && curl -fsSL https://claude.ai/install.sh | bash \
    && mkdir -p /home/bun/.claude \
    && uvx --version && claude --version

# Keep all Claude Code state (incl. ~/.claude.json: login, MCP approvals) in the claude-home volume
ENV CLAUDE_CONFIG_DIR=/home/bun/.claude

WORKDIR /home/bun/workspace
CMD ["sleep", "infinity"]
