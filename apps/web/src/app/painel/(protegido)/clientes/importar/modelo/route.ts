import { CSV_TEMPLATE } from '@contab/core';
import { requirePainel } from '@/server/painel';

/** Modelo de CSV com dados fictícios. O BOM faz o Excel abrir os acentos certos. */
export async function GET() {
  await requirePainel();
  return new Response(String.fromCharCode(0xfeff) + CSV_TEMPLATE, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="modelo-clientes.csv"',
    },
  });
}
