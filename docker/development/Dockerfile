FROM oven/bun:1

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    openssh-client \
    postgresql-client \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# Passwordless sudo, same as raven
RUN echo 'bun ALL=(root) NOPASSWD:ALL' > /etc/sudoers.d/bun \
    && chmod 0440 /etc/sudoers.d/bun

# Feature install scripts run as bun and need bash (default shell is sh)
RUN chsh -s /bin/bash bun

USER bun
WORKDIR /home/bun/workspace
CMD ["sleep", "infinity"]