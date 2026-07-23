// ─── Utils Barrel ───────────────────────────────────────────────────────────
//
// Usage in components:
//   import { api } from '@/utils';
//   import { SOCKET_EVENTS } from '@/constants';
//   import { socket } from '@/utils';
//
//   const data = await api.get<User[]>('/api/users/search', { q: 'john' });
//   const res = await socket.emit(SOCKET_EVENTS.SEND_MESSAGE, { ... });
//

export {
  api,
  request,
  getAccessToken,
  getRefreshToken,
  setTokens,
  clearTokens,
  loadRefreshToken,
  hydrateTokens,
} from './api';
export type { HttpMethod, RequestOptions, UploadFile } from './api';

export { socket } from './socket';
