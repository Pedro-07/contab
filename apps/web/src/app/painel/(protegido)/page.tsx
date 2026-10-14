import { ROLE_LABEL } from '@/lib/labels';
import { requirePainel } from '@/server/painel';

export default async function InicioPage() {
  const { organization } = await requirePainel();
  return (
    <main>
      <h1>{organization.name}</h1>
      <p>
        Você está como <strong>{ROLE_LABEL[organization.role]}</strong>.
      </p>
      <p className="muted">
        Esta é a Fundação da plataforma. Clientes, documentos e guias chegam nos próximos
        incrementos.
      </p>
    </main>
  );
}
