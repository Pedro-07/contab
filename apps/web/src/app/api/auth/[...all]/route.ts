import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@/server/services';

export const { GET, POST } = toNextJsHandler((request: Request) => getAuth().handler(request));
