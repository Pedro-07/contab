export { createAuth, MAGIC_LINK_TTL_SECONDS, type Auth, type AuthDeps } from './auth';
export {
  mfaRequired,
  readPainelSession,
  resolvePainel,
  switchOrganization,
  type PainelSession,
  type PainelState,
  type RequestMeta,
} from './painel';
