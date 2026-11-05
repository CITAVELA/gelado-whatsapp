// Capa de datos de la bandeja: una función por endpoint (contrato en packages/shared/src/endpoints.ts).
// `inboxApi` es la API real salvo que VITE_INBOX_MOCK=1, que usa la implementación en memoria de mock.ts.
import type {
  ConversationDetailDto,
  ConversationListItemDto,
  CursorPage,
  InboxCountsDto,
  InboxView,
  LabelDto,
  LibraryFileDto,
  LibraryFolderDto,
  MediaDto,
  MessageDto,
  Paginated,
  Rates,
  SendMessageDto,
  SnoozeDto,
  TemplateDto,
  TimelineItemDto,
  UserDto,
} from '@gelado/shared';
import { api, qs } from '../../lib/api';

export interface ListParams {
  view?: InboxView;
  status?: 'OPEN' | 'SNOOZED' | 'DONE';
  /** etiqueta de contacto (tipo de cliente) */
  labelId?: string;
  assigneeId?: string;
  /** etiqueta de conversación (tema) */
  conversationLabelId?: string;
  q?: string;
  cursor?: string | null;
  limit?: number;
}

export interface InboxApi {
  /** GET /api/conversations */
  listConversations(p: ListParams): Promise<CursorPage<ConversationListItemDto>>;
  /** GET /api/conversations/counts */
  counts(): Promise<InboxCountsDto>;
  /** POST /api/conversations  { phone, firstName? } */
  newConversation(body: { phone: string; firstName?: string }): Promise<ConversationDetailDto>;
  /** GET /api/conversations/:id */
  getConversation(id: string): Promise<ConversationDetailDto>;
  /** GET /api/conversations/:id/timeline?cursor&limit — elementos más antiguos con `cursor` */
  timeline(id: string, p: { cursor?: string | null; limit?: number }): Promise<CursorPage<TimelineItemDto>>;
  /** POST /api/conversations/:id/messages */
  sendMessage(id: string, dto: SendMessageDto): Promise<MessageDto>;
  /** POST /api/conversations/:id/messages/:messageId/retry */
  retryMessage(id: string, messageId: string): Promise<MessageDto>;
  /** POST /api/conversations/:id/read */
  markRead(id: string): Promise<void>;
  /** POST /api/conversations/:id/unread */
  markUnread(id: string): Promise<void>;
  /** POST /api/conversations/:id/assign  { assigneeId | null } */
  assign(id: string, assigneeId: string | null): Promise<void>;
  /** POST /api/conversations/:id/snooze */
  snooze(id: string, dto: SnoozeDto): Promise<void>;
  /** POST /api/conversations/:id/done */
  done(id: string): Promise<void>;
  /** POST /api/conversations/:id/reopen */
  reopen(id: string): Promise<void>;
  /** POST /api/conversations/:id/star  { starred } */
  star(id: string, starred: boolean): Promise<void>;
  /** POST /api/conversations/:id/labels  { add, remove } */
  setLabels(id: string, dto: { add: string[]; remove: string[] }): Promise<void>;
  /** POST /api/media (multipart, campo «file») → MediaFile */
  uploadMedia(file: File | Blob, fileName?: string): Promise<MediaDto>;
  /** GET /api/library/folders */
  libraryFolders(): Promise<LibraryFolderDto[]>;
  /** GET /api/library/files?folderId&q */
  libraryFiles(p: { folderId?: string | null; q?: string }): Promise<LibraryFileDto[]>;
  /** GET /api/templates?status=APPROVED */
  approvedTemplates(): Promise<TemplateDto[]>;
  /** GET /api/settings → solo se usa `rates` */
  rates(): Promise<Rates>;
  /** GET /api/users */
  users(): Promise<Pick<UserDto, 'id' | 'name' | 'active'>[]>;
  /** GET /api/labels */
  labels(): Promise<LabelDto[]>;
}

const items = <T,>(r: T[] | Paginated<T> | { items: T[] }): T[] => (Array.isArray(r) ? r : r.items);

export const realApi: InboxApi = {
  listConversations: (p) => api.get(`/api/conversations${qs({ ...p })}`),
  counts: () => api.get('/api/conversations/counts'),
  newConversation: (body) => api.post('/api/conversations', body),
  getConversation: (id) => api.get(`/api/conversations/${id}`),
  timeline: (id, p) => api.get(`/api/conversations/${id}/timeline${qs({ ...p })}`),
  sendMessage: (id, dto) => api.post(`/api/conversations/${id}/messages`, dto),
  retryMessage: (id, messageId) => api.post(`/api/conversations/${id}/messages/${messageId}/retry`),
  markRead: (id) => api.post(`/api/conversations/${id}/read`),
  markUnread: (id) => api.post(`/api/conversations/${id}/unread`),
  assign: (id, assigneeId) => api.post(`/api/conversations/${id}/assign`, { assigneeId }),
  snooze: (id, dto) => api.post(`/api/conversations/${id}/snooze`, dto),
  done: (id) => api.post(`/api/conversations/${id}/done`),
  reopen: (id) => api.post(`/api/conversations/${id}/reopen`),
  star: (id, starred) => api.post(`/api/conversations/${id}/star`, { starred }),
  setLabels: (id, dto) => api.post(`/api/conversations/${id}/labels`, dto),
  uploadMedia: (file, fileName) => {
    const form = new FormData();
    form.append('file', file, fileName ?? (file instanceof File ? file.name : 'archivo'));
    return api.upload('/api/media', form);
  },
  libraryFolders: () => api.get<LibraryFolderDto[]>('/api/library/folders'),
  libraryFiles: async (p) => items(await api.get<LibraryFileDto[] | { items: LibraryFileDto[] }>(`/api/library/files${qs({ ...p })}`)),
  approvedTemplates: async () => items(await api.get<TemplateDto[] | Paginated<TemplateDto>>('/api/templates?status=APPROVED')),
  rates: async () => (await api.get<{ rates: Rates }>('/api/settings')).rates,
  users: () => api.get('/api/users'),
  labels: () => api.get('/api/labels'),
};

import { mockApi, installMockAuth } from './mock';

export const MOCK_ENABLED = import.meta.env.VITE_INBOX_MOCK === '1';
if (MOCK_ENABLED) installMockAuth();

let current: InboxApi = MOCK_ENABLED ? mockApi : realApi;
/** Cambia la implementación (pruebas). */
export function setInboxApi(impl: InboxApi) {
  current = impl;
}
/** API activa de la bandeja (real o simulada). */
export const inboxApi: InboxApi = new Proxy({} as InboxApi, {
  get: (_t, k) => (current as unknown as Record<string, unknown>)[k as string],
});
