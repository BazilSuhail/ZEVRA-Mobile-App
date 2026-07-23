// ─── Local DB types (Phase 1) + SQLite implementation (Phase 2) ────────────
//
// Same table/API surface as zevra-client's Dexie `lib/db.ts`, but backed by
// expo-sqlite (IndexedDB doesn't exist on RN). Helper signatures are identical
// so consumers port 1:1.

import { MessageStatus } from '@/constants';

// ─── Types ──────────────────────────────────────────────────────────────────

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
  // Decrypted plaintext (kept in DB for fast load)
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
