// ─── Local DB — expo-sqlite implementation (Phase 2) ────────────────────────
//
// Port of zevra-client's Dexie `lib/db.ts` (IndexedDB) to expo-sqlite.
// Helper function signatures/semantics are kept 1:1 so consumers port as-is.
//
// Differences from web (unavoidable):
//   • `getDB()` / `closeDB()` are async — SQLite opens lazily via a promise.
//     (web: sync Dexie instance)
//   • Table access via helpers, not table objects: web's `getDB().identity.*`
//     calls (lib/e2ee.ts) become `saveIdentity`/`getIdentity`/`deleteIdentity`
//     in Phase 3.
//   • Booleans are stored as 0/1 INTEGER and mapped back to boolean on read.
//   • `metadata` is stored as a JSON string and parsed on read.
//   • `getChannelMessages(channelId, limit)` ignores `limit` — web's Dexie
//     `sortBy` does too (all callers pass no limit and expect full history).

import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { MessageStatus } from '@/constants';
import { api } from '@/utils/api';

// ─── Types (identical to web) ───────────────────────────────────────────────

export interface StoredMessage {
  id: string;
  channelId: string;
  senderId: string;
  ciphertext: string;
  iv: string;
  tag: string;
  signature: string;
  sequenceNumber: number;
  senderKeyEpoch: number;
  messageType: string;
  metadata: Record<string, unknown> | null;
  isDeleted: boolean;
  // Decrypted plaintext (kept in IDB for fast load)
  plaintext: string;
  // Delivery status
  status: MessageStatus;
  // Timestamps
  createdAt: string; // ISO string
  updatedAt: string;
}

// A single emoji reaction on a message (server-broadcast / history payload)
export interface MessageReaction {
  emoji: string;
  userId: string;
  username: string | null;
}

export interface StoredRoom {
  id: string;
  name: string | null;
  type: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  isArchived: boolean;
  updatedAt: string;
}

export interface StoredKey {
  channelId: string;
  wrappedKey: string; // AES-KW wrapped chat key (base64)
  epoch: number;
  updatedAt: string;
}

export interface PendingOp {
  id: string;
  type: 'send' | 'reaction' | 'mark-read';
  channelId: string;
  payload: string; // JSON serialized
  status: 'pending' | 'failed';
  retries: number;
  createdAt: string;
}

export interface StoredIdentity {
  id: 'me';
  userId: string;
  publicKey: string;
  publicKeySign: string;
  privateKey: string; // base64 raw 32B
  privateKeySign: string; // base64 raw 32B
}

export interface StoredCall {
  id: string;
  type: 'WEBRTC' | 'LIVEKIT';
  peerId: string;
  peerUsername: string;
  direction: 'incoming' | 'outgoing';
  startedAt: string;
  endedAt: string | null;
  duration: number | null;
  status: 'missed' | 'completed' | 'rejected' | 'cancelled';
}

// ─── Schema ─────────────────────────────────────────────────────────────────

const DB_NAME = 'zevra-chat';

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  channelId TEXT NOT NULL,
  senderId TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  tag TEXT NOT NULL,
  signature TEXT NOT NULL,
  sequenceNumber INTEGER NOT NULL,
  senderKeyEpoch INTEGER NOT NULL,
  messageType TEXT NOT NULL,
  metadata TEXT,
  isDeleted INTEGER NOT NULL DEFAULT 0,
  plaintext TEXT NOT NULL,
  status TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_channel_created ON messages (channelId, createdAt);
CREATE INDEX IF NOT EXISTS idx_messages_channel_seq ON messages (channelId, sequenceNumber);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages (senderId);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages (status);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT,
  type TEXT NOT NULL,
  lastMessageAt TEXT,
  lastMessagePreview TEXT,
  unreadCount INTEGER NOT NULL DEFAULT 0,
  isArchived INTEGER NOT NULL DEFAULT 0,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rooms_lastMessageAt ON rooms (lastMessageAt);
CREATE INDEX IF NOT EXISTS idx_rooms_unreadCount ON rooms (unreadCount);

CREATE TABLE IF NOT EXISTS keys (
  channelId TEXT PRIMARY KEY NOT NULL,
  wrappedKey TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pendingOps (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  channelId TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  retries INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pendingOps_status ON pendingOps (status);
CREATE INDEX IF NOT EXISTS idx_pendingOps_channelId ON pendingOps (channelId);
CREATE INDEX IF NOT EXISTS idx_pendingOps_createdAt ON pendingOps (createdAt);

CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  peerId TEXT NOT NULL,
  peerUsername TEXT NOT NULL,
  direction TEXT NOT NULL,
  startedAt TEXT NOT NULL,
  endedAt TEXT,
  duration INTEGER,
  status TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calls_peerId ON calls (peerId);
CREATE INDEX IF NOT EXISTS idx_calls_startedAt ON calls (startedAt);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls (status);

CREATE TABLE IF NOT EXISTS identity (
  id TEXT PRIMARY KEY NOT NULL,
  userId TEXT NOT NULL,
  publicKey TEXT NOT NULL,
  publicKeySign TEXT NOT NULL,
  privateKey TEXT NOT NULL,
  privateKeySign TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_identity_userId ON identity (userId);
`;

// ─── Upserts (Dexie `put` = SQL upsert) ────────────────────────────────────

const MESSAGE_UPSERT_SQL = `
INSERT INTO messages (
  id, channelId, senderId, ciphertext, iv, tag, signature, sequenceNumber,
  senderKeyEpoch, messageType, metadata, isDeleted, plaintext, status, createdAt, updatedAt
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  channelId = excluded.channelId,
  senderId = excluded.senderId,
  ciphertext = excluded.ciphertext,
  iv = excluded.iv,
  tag = excluded.tag,
  signature = excluded.signature,
  sequenceNumber = excluded.sequenceNumber,
  senderKeyEpoch = excluded.senderKeyEpoch,
  messageType = excluded.messageType,
  metadata = excluded.metadata,
  isDeleted = excluded.isDeleted,
  plaintext = excluded.plaintext,
  status = excluded.status,
  createdAt = excluded.createdAt,
  updatedAt = excluded.updatedAt
`;

const ROOM_UPSERT_SQL = `
INSERT INTO rooms (
  id, name, type, lastMessageAt, lastMessagePreview, unreadCount, isArchived, updatedAt
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  type = excluded.type,
  lastMessageAt = excluded.lastMessageAt,
  lastMessagePreview = excluded.lastMessagePreview,
  unreadCount = excluded.unreadCount,
  isArchived = excluded.isArchived,
  updatedAt = excluded.updatedAt
`;

const KEY_UPSERT_SQL = `
INSERT INTO keys (channelId, wrappedKey, epoch, updatedAt) VALUES (?, ?, ?, ?)
ON CONFLICT(channelId) DO UPDATE SET
  wrappedKey = excluded.wrappedKey,
  epoch = excluded.epoch,
  updatedAt = excluded.updatedAt
`;

const PENDING_OP_UPSERT_SQL = `
INSERT INTO pendingOps (id, type, channelId, payload, status, retries, createdAt)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  type = excluded.type,
  channelId = excluded.channelId,
  payload = excluded.payload,
  status = excluded.status,
  retries = excluded.retries,
  createdAt = excluded.createdAt
`;

const CALL_UPSERT_SQL = `
INSERT INTO calls (
  id, type, peerId, peerUsername, direction, startedAt, endedAt, duration, status
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  type = excluded.type,
  peerId = excluded.peerId,
  peerUsername = excluded.peerUsername,
  direction = excluded.direction,
  startedAt = excluded.startedAt,
  endedAt = excluded.endedAt,
  duration = excluded.duration,
  status = excluded.status
`;

const IDENTITY_UPSERT_SQL = `
INSERT INTO identity (id, userId, publicKey, publicKeySign, privateKey, privateKeySign)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  userId = excluded.userId,
  publicKey = excluded.publicKey,
  publicKeySign = excluded.publicKeySign,
  privateKey = excluded.privateKey,
  privateKeySign = excluded.privateKeySign
`;

// ─── Rows → domain ──────────────────────────────────────────────────────────

interface MessageRow {
  id: string;
  channelId: string;
  senderId: string;
  ciphertext: string;
  iv: string;
  tag: string;
  signature: string;
  sequenceNumber: number;
  senderKeyEpoch: number;
  messageType: string;
  metadata: string | null;
  isDeleted: number;
  plaintext: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface RoomRow {
  id: string;
  name: string | null;
  type: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  isArchived: number;
  updatedAt: string;
}

interface KeyRow {
  channelId: string;
  wrappedKey: string;
  epoch: number;
  updatedAt: string;
}

interface PendingOpRow {
  id: string;
  type: string;
  channelId: string;
  payload: string;
  status: string;
  retries: number;
  createdAt: string;
}

interface CallRow {
  id: string;
  type: string;
  peerId: string;
  peerUsername: string;
  direction: string;
  startedAt: string;
  endedAt: string | null;
  duration: number | null;
  status: string;
}

interface IdentityRow {
  id: string;
  userId: string;
  publicKey: string;
  publicKeySign: string;
  privateKey: string;
  privateKeySign: string;
}

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mapMessage(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    channelId: row.channelId,
    senderId: row.senderId,
    ciphertext: row.ciphertext,
    iv: row.iv,
    tag: row.tag,
    signature: row.signature,
    sequenceNumber: Number(row.sequenceNumber),
    senderKeyEpoch: Number(row.senderKeyEpoch),
    messageType: row.messageType,
    metadata: parseMetadata(row.metadata),
    isDeleted: row.isDeleted === 1,
    plaintext: row.plaintext,
    status: row.status as MessageStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapRoom(row: RoomRow): StoredRoom {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    lastMessageAt: row.lastMessageAt,
    lastMessagePreview: row.lastMessagePreview,
    unreadCount: Number(row.unreadCount),
    isArchived: row.isArchived === 1,
    updatedAt: row.updatedAt,
  };
}

function mapKey(row: KeyRow): StoredKey {
  return { ...row, epoch: Number(row.epoch) };
}

function mapPendingOp(row: PendingOpRow): PendingOp {
  return {
    id: row.id,
    type: row.type as PendingOp['type'],
    channelId: row.channelId,
    payload: row.payload,
    status: row.status as PendingOp['status'],
    retries: Number(row.retries),
    createdAt: row.createdAt,
  };
}

function mapCall(row: CallRow): StoredCall {
  return {
    id: row.id,
    type: row.type as StoredCall['type'],
    peerId: row.peerId,
    peerUsername: row.peerUsername,
    direction: row.direction as StoredCall['direction'],
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    duration: row.duration === null ? null : Number(row.duration),
    status: row.status as StoredCall['status'],
  };
}

function mapIdentity(row: IdentityRow): StoredIdentity {
  return {
    id: 'me',
    userId: row.userId,
    publicKey: row.publicKey,
    publicKeySign: row.publicKeySign,
    privateKey: row.privateKey,
    privateKeySign: row.privateKeySign,
  };
}

// ─── Param builders ─────────────────────────────────────────────────────────

function messageParams(m: StoredMessage): (string | number | null)[] {
  return [
    m.id,
    m.channelId,
    m.senderId,
    m.ciphertext,
    m.iv,
    m.tag,
    m.signature,
    m.sequenceNumber,
    m.senderKeyEpoch,
    m.messageType,
    m.metadata ? JSON.stringify(m.metadata) : null,
    m.isDeleted ? 1 : 0,
    m.plaintext,
    m.status,
    m.createdAt,
    m.updatedAt,
  ];
}

function roomParams(r: StoredRoom): (string | number | null)[] {
  return [
    r.id,
    r.name,
    r.type,
    r.lastMessageAt,
    r.lastMessagePreview,
    r.unreadCount,
    r.isArchived ? 1 : 0,
    r.updatedAt,
  ];
}

function keyParams(k: StoredKey): (string | number)[] {
  return [k.channelId, k.wrappedKey, k.epoch, k.updatedAt];
}

function pendingOpParams(o: PendingOp): (string | number)[] {
  return [o.id, o.type, o.channelId, o.payload, o.status, o.retries, o.createdAt];
}

function callParams(c: StoredCall): (string | number | null)[] {
  return [
    c.id,
    c.type,
    c.peerId,
    c.peerUsername,
    c.direction,
    c.startedAt,
    c.endedAt,
    c.duration,
    c.status,
  ];
}

function identityParams(i: StoredIdentity): string[] {
  return [i.id, i.userId, i.publicKey, i.publicKeySign, i.privateKey, i.privateKeySign];
}

// ─── Database ───────────────────────────────────────────────────────────────

// Singleton per app (schema runs idempotently — `IF NOT EXISTS`).
// Promise-memoized so concurrent callers share one open/init.
let dbPromise: Promise<SQLiteDatabase> | null = null;

export async function getDB(): Promise<SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const database = await openDatabaseAsync(DB_NAME);
      await database.execAsync(SCHEMA_SQL);
      return database;
    })();
  }
  try {
    return await dbPromise;
  } catch (err) {
    dbPromise = null; // allow retry after a failed open
    throw err;
  }
}

export async function closeDB(): Promise<void> {
  const pending = dbPromise;
  dbPromise = null;
  if (!pending) return;
  try {
    const database = await pending;
    await database.closeAsync();
  } catch {
    // already closed / open failed — nothing to clean up
  }
}

// ─── Message Helpers ────────────────────────────────────────────────────────

export async function saveMessage(message: StoredMessage): Promise<void> {
  const database = await getDB();
  await database.runAsync(MESSAGE_UPSERT_SQL, messageParams(message));
}

export async function saveMessages(messages: StoredMessage[]): Promise<void> {
  if (messages.length === 0) return;
  const database = await getDB();
  const statement = await database.prepareAsync(MESSAGE_UPSERT_SQL);
  try {
    await database.withTransactionAsync(async () => {
      for (const message of messages) {
        await statement.executeAsync(messageParams(message));
      }
    });
  } finally {
    await statement.finalizeAsync();
  }
}

export async function getMessage(messageId: string): Promise<StoredMessage | undefined> {
  const database = await getDB();
  const row = await database.getFirstAsync<MessageRow>(
    'SELECT * FROM messages WHERE id = ?',
    [messageId],
  );
  return row ? mapMessage(row) : undefined;
}

export async function getChannelMessages(
  channelId: string,
  _limit = 50,
): Promise<StoredMessage[]> {
  const database = await getDB();
  const rows = await database.getAllAsync<MessageRow>(
    'SELECT * FROM messages WHERE channelId = ? ORDER BY createdAt ASC',
    [channelId],
  );
  return rows.map(mapMessage);
}

export async function getLatestMessageTimestamp(
  channelId: string,
): Promise<string | null> {
  const database = await getDB();
  const row = await database.getFirstAsync<{ createdAt: string }>(
    'SELECT createdAt FROM messages WHERE channelId = ? ORDER BY createdAt DESC LIMIT 1',
    [channelId],
  );
  return row?.createdAt ?? null;
}

export async function getChannelMessagesAfter(
  channelId: string,
  afterTimestamp: string,
): Promise<StoredMessage[]> {
  const database = await getDB();
  // Dexie: between([channelId, ts], [channelId, '\uffff']) → createdAt >= ts
  const rows = await database.getAllAsync<MessageRow>(
    'SELECT * FROM messages WHERE channelId = ? AND createdAt >= ? ORDER BY createdAt ASC',
    [channelId, afterTimestamp],
  );
  return rows.map(mapMessage);
}

export async function updateMessageStatus(
  messageId: string,
  status: MessageStatus,
): Promise<void> {
  const database = await getDB();
  await database.runAsync('UPDATE messages SET status = ? WHERE id = ?', [
    status,
    messageId,
  ]);
}

export async function deleteMessage(messageId: string): Promise<void> {
  const database = await getDB();
  await database.runAsync('DELETE FROM messages WHERE id = ?', [messageId]);
}

// ─── Room Helpers ───────────────────────────────────────────────────────────

export async function saveRoom(room: StoredRoom): Promise<void> {
  const database = await getDB();
  await database.runAsync(ROOM_UPSERT_SQL, roomParams(room));
}

export async function getRooms(): Promise<StoredRoom[]> {
  const database = await getDB();
  const rows = await database.getAllAsync<RoomRow>(
    'SELECT * FROM rooms ORDER BY lastMessageAt DESC, updatedAt DESC',
  );
  return rows.map(mapRoom);
}

export async function getRoom(channelId: string): Promise<StoredRoom | undefined> {
  const database = await getDB();
  const row = await database.getFirstAsync<RoomRow>('SELECT * FROM rooms WHERE id = ?', [
    channelId,
  ]);
  return row ? mapRoom(row) : undefined;
}

export async function updateRoomUnread(channelId: string, count: number): Promise<void> {
  const database = await getDB();
  await database.runAsync('UPDATE rooms SET unreadCount = ? WHERE id = ?', [
    count,
    channelId,
  ]);
}

export async function incrementRoomUnread(channelId: string): Promise<void> {
  const database = await getDB();
  await database.runAsync(
    'UPDATE rooms SET unreadCount = unreadCount + 1 WHERE id = ?',
    [channelId],
  );
}

// ─── Key Helpers ────────────────────────────────────────────────────────────

export async function saveKey(key: StoredKey): Promise<void> {
  const database = await getDB();
  await database.runAsync(KEY_UPSERT_SQL, keyParams(key));
}

export async function getKey(channelId: string): Promise<StoredKey | undefined> {
  const database = await getDB();
  const row = await database.getFirstAsync<KeyRow>(
    'SELECT * FROM keys WHERE channelId = ?',
    [channelId],
  );
  return row ? mapKey(row) : undefined;
}

// ─── Pending Ops Helpers ────────────────────────────────────────────────────

export async function addPendingOp(op: PendingOp): Promise<void> {
  const database = await getDB();
  await database.runAsync(PENDING_OP_UPSERT_SQL, pendingOpParams(op));
}

export async function getPendingOps(): Promise<PendingOp[]> {
  const database = await getDB();
  const rows = await database.getAllAsync<PendingOpRow>(
    "SELECT * FROM pendingOps WHERE status = 'pending' ORDER BY createdAt ASC",
  );
  return rows.map(mapPendingOp);
}

export async function updatePendingOp(id: string, updates: Partial<PendingOp>): Promise<void> {
  const allowed = ['type', 'channelId', 'payload', 'status', 'retries', 'createdAt'];
  const entries = Object.entries(updates).filter(([key]) => allowed.includes(key));
  if (entries.length === 0) return;
  const database = await getDB();
  const setClause = entries.map(([key]) => `${key} = ?`).join(', ');
  const values = entries.map(([, value]) => value as string | number);
  await database.runAsync(`UPDATE pendingOps SET ${setClause} WHERE id = ?`, [
    ...values,
    id,
  ]);
}

export async function removePendingOp(id: string): Promise<void> {
  const database = await getDB();
  await database.runAsync('DELETE FROM pendingOps WHERE id = ?', [id]);
}

// ─── Bulk Operations ────────────────────────────────────────────────────────

export async function getUnreadCounts(): Promise<Record<string, number>> {
  const database = await getDB();
  const rows = await database.getAllAsync<{ id: string; unreadCount: number }>(
    'SELECT id, unreadCount FROM rooms WHERE unreadCount > 0',
  );
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.id] = Number(row.unreadCount);
  }
  return counts;
}

export async function clearAll(): Promise<void> {
  const database = await getDB();
  // Same tables as web's Dexie clearAll — `identity` is intentionally kept
  // (cleared via deleteIdentity on logout).
  await database.withTransactionAsync(async () => {
    await database.execAsync('DELETE FROM messages');
    await database.execAsync('DELETE FROM rooms');
    await database.execAsync('DELETE FROM keys');
    await database.execAsync('DELETE FROM pendingOps');
    await database.execAsync('DELETE FROM calls');
  });
}

// ─── Call Helpers ───────────────────────────────────────────────────────────

export async function saveCall(call: StoredCall): Promise<void> {
  const database = await getDB();
  await database.runAsync(CALL_UPSERT_SQL, callParams(call));
}

export async function getCalls(): Promise<StoredCall[]> {
  const database = await getDB();
  const rows = await database.getAllAsync<CallRow>(
    'SELECT * FROM calls ORDER BY startedAt DESC',
  );
  return rows.map(mapCall);
}

export async function getCall(callId: string): Promise<StoredCall | undefined> {
  const database = await getDB();
  const row = await database.getFirstAsync<CallRow>('SELECT * FROM calls WHERE id = ?', [
    callId,
  ]);
  return row ? mapCall(row) : undefined;
}

export async function updateCall(callId: string, updates: Partial<StoredCall>): Promise<void> {
  const allowed = [
    'type',
    'peerId',
    'peerUsername',
    'direction',
    'startedAt',
    'endedAt',
    'duration',
    'status',
  ];
  const entries = Object.entries(updates).filter(([key]) => allowed.includes(key));
  if (entries.length === 0) return;
  const database = await getDB();
  const setClause = entries.map(([key]) => `${key} = ?`).join(', ');
  const values = entries.map(([, value]) => value as string | number | null);
  await database.runAsync(`UPDATE calls SET ${setClause} WHERE id = ?`, [...values, callId]);
}

export async function deleteCall(callId: string): Promise<void> {
  const database = await getDB();
  await database.runAsync('DELETE FROM calls WHERE id = ?', [callId]);
}

export async function searchCalls(query: string): Promise<StoredCall[]> {
  const database = await getDB();
  const rows = await database.getAllAsync<CallRow>('SELECT * FROM calls');
  const lower = query.toLowerCase();
  return rows
    .map(mapCall)
    .filter((c) => c.peerUsername.toLowerCase().includes(lower));
}

// ─── Identity Helpers (mobile replacement for getDB().identity.*) ───────────
//
// web lib/e2ee.ts does `getDB().identity.put/get/delete` — SQLite has no
// table objects, so these helpers are the portable equivalent (Phase 3).

export async function saveIdentity(identity: StoredIdentity): Promise<void> {
  const database = await getDB();
  await database.runAsync(IDENTITY_UPSERT_SQL, identityParams(identity));
}

export async function getIdentity(): Promise<StoredIdentity | undefined> {
  const database = await getDB();
  const row = await database.getFirstAsync<IdentityRow>(
    "SELECT * FROM identity WHERE id = 'me'",
  );
  return row ? mapIdentity(row) : undefined;
}

export async function deleteIdentity(): Promise<void> {
  const database = await getDB();
  await database.runAsync("DELETE FROM identity WHERE id = 'me'");
}

// ─── Server Call History ─────────────────────────────────────────────────────

interface ServerCallLog {
  id: string;
  type: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  duration: number | null;
  room_name: string | null;
  caller_id: string;
  caller_username: string;
  callee_id: string;
  callee_username: string;
  participants: {
    userId: string;
    username: string;
    joinedAt: string;
    leftAt: string | null;
    duration: number | null;
  }[];
}

interface CallHistoryResponse {
  calls: ServerCallLog[];
  page: number;
  hasMore: boolean;
}

export async function fetchAndCacheCallHistory(
  userId: string,
  page = 1,
  limit = 50,
): Promise<StoredCall[]> {
  const res = await api.get<CallHistoryResponse>(
    `/calls/history?page=${page}&limit=${limit}`,
  );

  if (!res?.calls) return getCalls();

  const stored: StoredCall[] = res.calls.map((c) => ({
    id: c.id,
    type: c.type as 'WEBRTC' | 'LIVEKIT',
    peerId: c.caller_id === userId ? c.callee_id : c.caller_id,
    peerUsername: c.caller_id === userId ? c.callee_username : c.caller_username,
    direction: c.caller_id === userId ? 'outgoing' : 'incoming',
    startedAt: c.started_at,
    endedAt: c.ended_at,
    duration: c.duration,
    status: c.status as StoredCall['status'],
  }));

  const database = await getDB();
  const statement = await database.prepareAsync(CALL_UPSERT_SQL);
  try {
    await database.withTransactionAsync(async () => {
      for (const call of stored) {
        await statement.executeAsync(callParams(call));
      }
    });
  } finally {
    await statement.finalizeAsync();
  }

  return stored;
}
