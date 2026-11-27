import WebSocket, { type RawData } from 'ws';

// Whose connection it is: the user and the session (the hash of its token) of the upgrade
// request. Absent on a server without accounts.
export interface ConnectionOwner {
  userId: number;
  session: string;
}

export interface Connection {
  readonly id: number;
  readonly ip: string;
  readonly connectedAt: number;
  readonly owner?: ConnectionOwner;
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

  add(ws: WebSocket, ip: string, owner?: ConnectionOwner): Connection {
    const connection: Connection = {
      id: this.nextId++,
      ip,
      connectedAt: Date.now(),
      owner,
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

  // Starts closing an open connection. False if it is unknown or already closing: it stays
  // in the registry until its close handshake is over.
  close(connection: Connection, code: number, reason: string): boolean {
    const entry = this.connections.get(connection.id);

    if (!entry || !this.isActive(entry)) {
      return false;
    }

    entry.ws.close(code, reason);
    return true;
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

  // Closes the connections the test picks and returns how many.
  closeWhere(matches: (connection: Connection) => boolean, code: number, reason: string): number {
    let closed = 0;
    for (const { connection } of this.connections.values()) {
      // One that is already closing (its session ended a moment ago) is not closed twice
      if (matches(connection) && this.close(connection, code, reason)) closed++;
    }
    return closed;
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
