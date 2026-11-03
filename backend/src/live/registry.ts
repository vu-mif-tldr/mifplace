import WebSocket, { type RawData } from 'ws';

export interface Connection {
  readonly id: number;
  readonly ip: string;
  readonly connectedAt: number;
}

export interface RegistryHooks {
  onMessage?(connection: Connection, data: string): void;
  onActivity?(connection: Connection): void;
  onClose?(connection: Connection, code: number): void;
}

type RegisteredConnection = {
  connection: Connection;
  ws: WebSocket;
  terminating: boolean;
};

export class ConnectionRegistry {
  private readonly connections = new Map<number, RegisteredConnection>();
  private nextId = 1;
  private slowDropped = 0;
  private terminated = 0;

  constructor(
    private readonly options: { maxBufferedBytes: number },
    private readonly hooks: RegistryHooks = {}
  ) {}

  add(ws: WebSocket, ip: string): Connection {
    const connection: Connection = {
      id: this.nextId++,
      ip,
      connectedAt: Date.now(),
    };

    const entry: RegisteredConnection = {
      connection,
      ws,
      terminating: false,
    };

    this.connections.set(connection.id, entry);

    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (!this.isActive(entry)) {
        return;
      }

      if (isBinary) {
        this.close(connection, 1003, 'Binary messages are not supported');
        return;
      }

      this.hooks.onActivity?.(connection);
      this.hooks.onMessage?.(connection, data.toString());
    });

    ws.on('pong', () => {
      if (this.isActive(entry)) {
        this.hooks.onActivity?.(connection);
      }
    });

    ws.on('error', () => {
      this.terminate(connection);
    });

    ws.on('close', (code: number) => {
      if (!this.connections.delete(connection.id)) {
        return;
      }

      this.hooks.onClose?.(connection, code);
    });

    return connection;
  }

  private isActive(entry: RegisteredConnection): boolean {
    return (
      this.connections.get(entry.connection.id) === entry &&
      !entry.terminating &&
      entry.ws.readyState === WebSocket.OPEN
    );
  }

  send(connection: Connection, data: string): void {
    const entry = this.connections.get(connection.id);

    if (!entry || !this.isActive(entry)) {
      return;
    }

    if (entry.ws.bufferedAmount > this.options.maxBufferedBytes) {
      this.slowDropped++;
      this.terminate(connection);
      return;
    }

    entry.ws.send(data);
  }

  broadcast(data: string): void {
    for (const { connection } of this.connections.values()) {
      this.send(connection, data);
    }
  }

  ping(connection: Connection): void {
    const entry = this.connections.get(connection.id);

    if (entry && this.isActive(entry)) {
      entry.ws.ping();
    }
  }

  close(connection: Connection, code: number, reason: string): void {
    const entry = this.connections.get(connection.id);

    if (entry && this.isActive(entry)) {
      entry.ws.close(code, reason);
    }
  }

  terminate(connection: Connection): void {
    const entry = this.connections.get(connection.id);

    if (!entry || entry.terminating) {
      return;
    }

    entry.terminating = true;
    this.terminated++;
    entry.ws.terminate();
  }

  closeAll(code: number, reason: string): void {
    for (const { connection } of this.connections.values()) {
      this.close(connection, code, reason);
    }
  }

  get size(): number {
    return this.connections.size;
  }

  stats(): { open: number; slowDropped: number; terminated: number } {
    let open = 0;

    for (const entry of this.connections.values()) {
      if (this.isActive(entry)) {
        open++;
      }
    }

    return {
      open,
      slowDropped: this.slowDropped,
      terminated: this.terminated,
    };
  }
}
