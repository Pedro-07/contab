/**
 * Serpro (incremento 4): conexão, rotina do mês (S1, S2), guia gerada com vínculo e leitura
 * do PDF conferidos (RN17), pagamento (I5), recálculo (RN2, CA2), disjuntor, custo e
 * isolamento. A Serpro é a simulada, com as respostas gravadas do trial.
 *
 * Cada cenário usa um escritório novo, para a rotina não mexer nos dados dos outros testes.
 */
import {
  FAKE_ERRORS,
  parseEnvelope,
  recording,
  simulateIdentity,
  type SerproEnvelope,
  type SerproRequest,
} from '@contab/adapters/serpro';
import {
  connectFiscalOwn,
  connectFiscalPlatform,
  getCompanyFiscalStatus,
  getFiscalConnectionView,
  openSecureLink,
  requestFiscalCheckNow,
  requestRecalcByLink,
  requestRecalcByStaff,
} from '@contab/core';
import {
  runSerproRecalc,
  runSerproTenant,
  runSerproWatch,
  type FiscalDeps,
} from '@contab/core/serpro-worker';
import {
  createTenantSettings,
  ForbiddenError,
  NotFoundError,
  upsertMembership,
  withTenant,
} from '@contab/db';
import { insertTenant, insertUser } from '@contab/db/global';
import { createBoss } from '@contab/db/queue';
import type { Db } from '@contab/db/testing';
import {
  asTenantId,
  asUserId,
  localDateAt,
  nominalDueDate,
  openPeriod,
  todayIn,
  type TaxRegime,
  type TenantId,
} from '@contab/domain';
import { createHash, randomUUID } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { connectFakeWhatsApp, testDeliveryDeps, type TestDeps } from './delivery-helpers';
import { memberCtx, ownerDb, securityEventsFor, systemCtx } from './helpers';

const seed = inject('seed');
const TZ = 'America/Fortaleza';
let owner: Db;
let boss: PgBoss;
let deps: TestDeps;

const PERIOD = openPeriod(todayIn(TZ));
const TERM_XML =
  '<?xml version="1.0"?><termoDeAutorizacao><dados>fictício</dados><Signature>assinatura-ficticia</Signature></termoDeAutorizacao>';

// ---------------------------------------------------------------------------
// Ajudantes
// ---------------------------------------------------------------------------

/** CNPJ válido aleatório (fictício). */
function randomCnpj(): string {
  const base = Array.from({ length: 12 }, (_, i) =>
    i >= 8 ? (i === 11 ? 1 : 0) : Math.floor(Math.random() * 10),
  );
  const dv = (digits: number[]) => {
    const weights =
      digits.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const rest = digits.reduce((acc, d, i) => acc + d * weights[i]!, 0) % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const d1 = dv(base);
  const d2 = dv([...base, d1]);
  return [...base, d1, d2].join('');
}

type Office = { id: TenantId; dono: () => ReturnType<typeof memberCtx>; contactId: string };

/** Escritório novo, com dono próprio, WhatsApp simulado e um contato. */
async function newOffice(connect = true): Promise<Office> {
  const tenant = await insertTenant({
    slug: `serpro-${randomUUID().slice(0, 8)}`,
    name: 'Escritório Serpro (fictício)',
  });
  const id = asTenantId(tenant.id);
  // Usuário só deste escritório: o dono do Alfa continua com um escritório só.
  const user = await insertUser({ email: `dono-${randomUUID().slice(0, 8)}@serpro.test` });
  const userId = asUserId(user.id);
  await withTenant(systemCtx(id), async (tx) => {
    await createTenantSettings(tx, id);
    await upsertMembership(tx, id, userId, 'dono');
  });
  const dono = () => memberCtx(id, userId, 'dono');
  const contactId = randomUUID();
  await owner.$client.query(
    `insert into contacts (tenant_id, id, name, phone, whatsapp_opt_in_at)
     values ($1, $2, 'Cliente Fictício', $3, now())`,
    [id, contactId, `+55989${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`],
  );
  await connectFakeWhatsApp(dono(), deps);
  if (connect) {
    await connectFiscalPlatform(dono(), deps, {
      officeCnpj: '44555666000181',
      termXml: TERM_XML,
      termValidUntil: '2030-12-31',
    });
    await drainOnly(id, ['serpro.connect']);
  }
  return { id, dono, contactId };
}

async function newCompany(office: Office, regime: TaxRegime) {
  const id = randomUUID();
  const cnpj = randomCnpj();
  await owner.$client.query(
    `insert into client_companies (tenant_id, id, cnpj, legal_name, regime) values ($1, $2, $3, $4, $5)`,
    [office.id, id, cnpj, `Empresa ${regime} Fictícia`, regime],
  );
  await owner.$client.query(
    `insert into company_contacts (tenant_id, id, company_id, contact_id, role) values ($1, $2, $3, $4, 'socio')`,
    [office.id, randomUUID(), id, office.contactId],
  );
  return { id, cnpj };
}

const KIND: Record<TaxRegime, string> = {
  MEI: 'das_mei',
  SN: 'das_simples',
  LP: 'dctfweb',
  LR: 'dctfweb',
};

async function newWatch(office: Office, companyId: string, regime: TaxRegime) {
  const id = randomUUID();
  await owner.$client.query(
    `insert into fiscal_watches (tenant_id, id, company_id, kind, period, next_check_at)
     values ($1, $2, $3, $4, $5, now())`,
    [office.id, id, companyId, KIND[regime], PERIOD],
  );
  return id;
}

/** Executa só os jobs dados (como o worker), sem rodar a rotina do escritório inteira. */
async function drainOnly(tenantId: TenantId, names: string[]) {
  const { createJobs } = await import('@contab/worker/jobs');
  const jobs = createJobs(deps).filter((j) => names.includes(j.name));
  for (let round = 0; round < 5; round++) {
    let found = 0;
    for (const job of jobs) {
      const items = await boss.fetch<{ tenantId?: string }>(job.name, { batchSize: 50 });
      for (const item of items) {
        if (item.data?.tenantId !== tenantId) {
          await boss.fail(job.name, item.id, { motivo: 'outro_teste' });
          continue;
        }
        found++;
        await job.run({ id: item.id, data: item.data });
        await boss.complete(job.name, item.id);
      }
    }
    if (!found) break;
  }
}

function runWatch(
  tenantId: TenantId,
  watchId: string,
  d: FiscalDeps = deps,
  trigger: 'rotina' | 'buscar_agora' = 'rotina',
) {
  const ctx = systemCtx(tenantId);
  return withTenant(ctx, (tx) => runSerproWatch(tx, ctx, d, watchId, trigger));
}

async function watchRow(watchId: string) {
  const { rows } = await owner.$client.query<{
    status: string;
    guide_id: string | null;
    last_error: string | null;
    checks: number;
    next_check_at: Date | null;
  }>(
    'select status, guide_id, last_error, checks, next_check_at from fiscal_watches where id = $1',
    [watchId],
  );
  return rows[0]!;
}

async function guideRow(guideId: string) {
  const { rows } = await owner.$client.query<{
    status: string;
    source: string;
    barcode: string | null;
    amount_cents: string;
    due_date: string;
    external_number: string | null;
    pdf_sha256: string | null;
    replaces_guide_id: string | null;
    receipt_storage_key: string | null;
  }>(
    `select status, source, barcode, amount_cents, to_char(due_date, 'YYYY-MM-DD') as due_date,
            external_number, pdf_sha256, replaces_guide_id, receipt_storage_key
       from guides where id = $1`,
    [guideId],
  );
  return rows[0]!;
}

async function alertsOf(tenantId: TenantId) {
  const { rows } = await owner.$client.query<{ kind: string; resource_id: string | null }>(
    'select kind, resource_id from tenant_alerts where tenant_id = $1 and resolved_at is null',
    [tenantId],
  );
  return rows;
}

async function callsOf(tenantId: TenantId) {
  const { rows } = await owner.$client.query<{
    service: string;
    status: string;
    purpose: string;
    cost_cents: number;
    error_kind: string | null;
  }>(
    'select service, status, purpose, cost_cents, error_kind from fiscal_calls where tenant_id = $1 order by created_at',
    [tenantId],
  );
  return rows;
}

const servicesCalled = (service: string) =>
  deps.serproFake.calls.filter((c) => c.service === service).length;

/** DAS do MEI gravado, mas com o PDF do DAS do Simples (o único com linha digitável real). */
function meiWithValidPdf(req: SerproRequest): SerproEnvelope {
  const env = parseEnvelope(200, recording('pgmei-gerardaspdf21'));
  const mei = JSON.parse(env.dados!);
  const simples = JSON.parse(parseEnvelope(200, recording('pgdasd-gerardas12')).dados!);
  mei[0].pdf = simples[0].pdf;
  mei[0].detalhamento[0].valores.total = 58.15;
  return simulateIdentity(req, { ...env, dados: JSON.stringify(mei) });
}

const hashToken = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

async function linkFor(tenantId: TenantId, guideId: string) {
  const token = randomUUID().replace(/-/g, '');
  await owner.$client.query(
    `insert into secure_links (tenant_id, id, token_hash, item_type, item_id, expires_at)
     values ($1, $2, $3, 'guia', $4, now() + interval '30 days')`,
    [tenantId, randomUUID(), hashToken(token), guideId],
  );
  return token;
}

beforeAll(async () => {
  owner = ownerDb();
  boss = createBoss(process.env.DATABASE_URL!);
  await boss.start();
  deps = testDeliveryDeps(boss);
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  await owner.$client.end();
});

// ---------------------------------------------------------------------------
// Conexão
// ---------------------------------------------------------------------------

describe('Conexões › Receita Federal', () => {
  it('modo plataforma: guarda o termo cifrado e ativa pelo worker', async () => {
    const office = await newOffice();
    const view = await getFiscalConnectionView(office.dono());
    expect(view.connection).toMatchObject({
      mode: 'plataforma',
      status: 'ativa',
      officeCnpj: '44555666000181',
    });
    expect(JSON.stringify(view)).not.toContain('assinatura-ficticia');
    const { rows } = await owner.$client.query<{ kind: string; ciphertext: string }>(
      'select kind, ciphertext from fiscal_credentials where tenant_id = $1',
      [office.id],
    );
    expect(rows.map((r) => r.kind)).toEqual(['serpro_termo_xml']);
    expect(rows[0]!.ciphertext).not.toContain('assinatura-ficticia');
    // Cifrado com o tenant: não abre no contexto de outro escritório.
    await expect(deps.cipher.decrypt(rows[0]!.ciphertext, seed.beta.id)).rejects.toThrow();
  });

  it('recusa XML sem assinatura, termo vencido e CNPJ inválido', async () => {
    const office = await newOffice(false);
    const base = { officeCnpj: '44555666000181', termXml: TERM_XML, termValidUntil: '2030-12-31' };
    await expect(
      connectFiscalPlatform(office.dono(), deps, { ...base, termXml: '<termo/>' }),
    ).rejects.toThrow(/assinado/);
    await expect(
      connectFiscalPlatform(office.dono(), deps, { ...base, termValidUntil: '2020-01-01' }),
    ).rejects.toThrow(/venceu/);
    await expect(
      connectFiscalPlatform(office.dono(), deps, { ...base, officeCnpj: '11111111111111' }),
    ).rejects.toThrow(/CNPJ/);
  });

  it('modo próprio: certificado inválido é recusado sem gravar nada', async () => {
    const office = await newOffice(false);
    await expect(
      connectFiscalOwn(office.dono(), deps, {
        officeCnpj: '44555666000181',
        consumerKey: 'chave-ficticia-123',
        consumerSecret: 'segredo-ficticio-123',
        certificate: new TextEncoder().encode('não é um pfx'),
        certificatePassword: 'senha',
      }),
    ).rejects.toThrow(/certificado/);
    const { rows } = await owner.$client.query(
      'select 1 from fiscal_connections where tenant_id = $1',
      [office.id],
    );
    expect(rows).toHaveLength(0);
  });

  it('atendente e contador não conectam (só dono e admin)', async () => {
    const input = { officeCnpj: '44555666000181', termXml: TERM_XML, termValidUntil: '2030-12-31' };
    await expect(
      connectFiscalPlatform(
        memberCtx(seed.alfa.id, seed.users.atendenteAlfa.id, 'atendente'),
        deps,
        input,
      ),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      connectFiscalPlatform(
        memberCtx(seed.alfa.id, seed.users.contadorAlfa.id, 'contador'),
        deps,
        input,
      ),
    ).rejects.toThrow(ForbiddenError);
  });
});

// ---------------------------------------------------------------------------
// Rotina do mês
// ---------------------------------------------------------------------------

describe('rotina do escritório (serpro.tenant)', () => {
  it('cria a rotina de cada empresa pelo regime e enfileira só as que venceram', async () => {
    const office = await newOffice();
    const mei = await newCompany(office, 'MEI');
    const sn = await newCompany(office, 'SN');
    const lp = await newCompany(office, 'LP');
    // Dia do MEI no fim do mês: a consulta do MEI fica para depois.
    await owner.$client.query(
      'update tenant_settings set mei_generation_day = 19 where tenant_id = $1',
      [office.id],
    );
    const ctx = systemCtx(office.id);
    const result = await withTenant(ctx, (tx) => runSerproTenant(tx, ctx, deps));
    expect(result.criadas).toBe(3);
    const { rows } = await owner.$client.query<{
      company_id: string;
      kind: string;
      next_check_at: Date;
    }>('select company_id, kind, next_check_at from fiscal_watches where tenant_id = $1', [
      office.id,
    ]);
    const byCompany = Object.fromEntries(rows.map((r) => [r.company_id, r]));
    expect(byCompany[mei.id]!.kind).toBe('das_mei');
    expect(byCompany[sn.id]!.kind).toBe('das_simples');
    expect(byCompany[lp.id]!.kind).toBe('dctfweb');
    const meiStart = localDateAt(`${nominalDueDate(PERIOD).slice(0, 8)}19`, 8, TZ);
    expect(byCompany[mei.id]!.next_check_at.toISOString()).toBe(meiStart.toISOString());
    // Rodar de novo não duplica.
    const again = await withTenant(ctx, (tx) => runSerproTenant(tx, ctx, deps));
    expect(again.criadas).toBe(0);
  });

  it('sem conexão ativa, não faz nada', async () => {
    const office = await newOffice(false);
    await newCompany(office, 'SN');
    const ctx = systemCtx(office.id);
    expect(await withTenant(ctx, (tx) => runSerproTenant(tx, ctx, deps))).toEqual({
      criadas: 0,
      enfileiradas: 0,
    });
  });

  it('termo vencendo gera aviso; termo vencido para a rotina', async () => {
    const office = await newOffice();
    await owner.$client.query(
      `update fiscal_connections set term_valid_until = now() + interval '5 days' where tenant_id = $1`,
      [office.id],
    );
    const ctx = systemCtx(office.id);
    await withTenant(ctx, (tx) => runSerproTenant(tx, ctx, deps));
    expect((await alertsOf(office.id)).map((a) => a.kind)).toContain('serpro_termo_vencendo');
    await owner.$client.query(
      `update fiscal_connections set term_valid_until = now() - interval '1 day' where tenant_id = $1`,
      [office.id],
    );
    await withTenant(ctx, (tx) => runSerproTenant(tx, ctx, deps));
    expect((await getFiscalConnectionView(office.dono())).connection?.status).toBe('erro');
    expect((await alertsOf(office.id)).map((a) => a.kind)).toContain('serpro_termo_vencido');
  });
});

describe('DAS do MEI (S2)', () => {
  it('gera, publica com linha conferida e entra na entrega', async () => {
    const office = await newOffice();
    const company = await newCompany(office, 'MEI');
    const watchId = await newWatch(office, company.id, 'MEI');
    deps.serproFake.on('GERARDASPDF21', meiWithValidPdf);
    try {
      expect(await runWatch(office.id, watchId)).toBe('gerada');
    } finally {
      deps.serproFake.on('GERARDASPDF21', null);
    }
    const watch = await watchRow(watchId);
    expect(watch.status).toBe('gerada');
    expect(watch.next_check_at).not.toBeNull();
    const guide = await guideRow(watch.guide_id!);
    expect(guide).toMatchObject({
      status: 'publicada',
      source: 'serpro',
      barcode: '858700000006581503282225430720222149018016787725',
      amount_cents: '5815',
      due_date: nominalDueDate(PERIOD),
    });
    expect(guide.external_number).toMatch(/^\d{17}$/);
    expect(guide.pdf_sha256).toMatch(/^[0-9a-f]{64}$/);
    // O contribuinte é o CNPJ da empresa do tenant; o autor, o escritório.
    const last = deps.serproFake.calls.filter((c) => c.service === 'GERARDASPDF21').at(-1)!;
    expect(last.parties).toEqual({
      contratante: '11222333000181',
      autor: '44555666000181',
      contribuinte: company.cnpj,
    });
    await drainOnly(office.id, ['delivery.plan', 'delivery.send']);
    const { rows } = await owner.$client.query<{ trigger: string; status: string }>(
      'select trigger, status from deliveries where item_id = $1',
      [watch.guide_id],
    );
    expect(rows).toEqual([{ trigger: 'publicacao', status: 'enviado' }]);
    expect((await callsOf(office.id)).map((c) => [c.service, c.status, c.cost_cents])).toEqual([
      ['GERARDASPDF21', 'sucesso', 0],
    ]);
  });

  it('PDF com linha que não confere: guia em rascunho, alerta e nada enviado (RN17)', async () => {
    const office = await newOffice();
    const company = await newCompany(office, 'MEI');
    const watchId = await newWatch(office, company.id, 'MEI');
    // A gravação do MEI tem a linha digitável zerada.
    expect(await runWatch(office.id, watchId)).toBe('revisao');
    const watch = await watchRow(watchId);
    expect(watch.status).toBe('revisao');
    expect(watch.last_error).toMatch(/linha digitável/);
    expect((await guideRow(watch.guide_id!)).status).toBe('rascunho');
    expect((await alertsOf(office.id)).map((a) => a.kind)).toContain('guia_revisao');
    const { rows } = await owner.$client.query('select 1 from deliveries where item_id = $1', [
      watch.guide_id,
    ]);
    expect(rows).toHaveLength(0);
  });

  it('resposta de outro CNPJ não vira guia (vínculo, RN17)', async () => {
    const office = await newOffice();
    const company = await newCompany(office, 'MEI');
    const watchId = await newWatch(office, company.id, 'MEI');
    deps.serproFake.on('GERARDASPDF21', (req) =>
      meiWithValidPdf({ ...req, parties: { ...req.parties, contribuinte: '99888777000162' } }),
    );
    try {
      expect(await runWatch(office.id, watchId)).toBe('revisao');
    } finally {
      deps.serproFake.on('GERARDASPDF21', null);
    }
    expect((await watchRow(watchId)).guide_id).toBeNull();
    const { rows } = await owner.$client.query('select 1 from guides where tenant_id = $1', [
      office.id,
    ]);
    expect(rows).toHaveLength(0);
    expect((await alertsOf(office.id)).map((a) => a.kind)).toContain('serpro_vinculo');
  });
});

describe('DAS do Simples (S1)', () => {
  it('sem declaração: espera o próximo dia útil; com declaração: gera e publica', async () => {
    const office = await newOffice();
    const company = await newCompany(office, 'SN');
    const watchId = await newWatch(office, company.id, 'SN');
    const emissions = servicesCalled('GERARDAS12');
    deps.serproFake.on('CONSULTIMADECREC14', () => FAKE_ERRORS.naoEncontrado());
    try {
      expect(await runWatch(office.id, watchId)).toBe('aguardando');
    } finally {
      deps.serproFake.on('CONSULTIMADECREC14', null);
    }
    let watch = await watchRow(watchId);
    expect(watch).toMatchObject({ status: 'aguardando', checks: 1, guide_id: null });
    expect(watch.next_check_at!.getTime()).toBeGreaterThan(Date.now());
    expect(servicesCalled('GERARDAS12')).toBe(emissions);

    expect(await runWatch(office.id, watchId)).toBe('gerada');
    watch = await watchRow(watchId);
    expect((await guideRow(watch.guide_id!)).status).toBe('publicada');
    expect((await callsOf(office.id)).map((c) => c.service)).toEqual([
      'CONSULTIMADECREC14',
      'CONSULTIMADECREC14',
      'GERARDAS12',
    ]);
  });

  it('idempotência: repetir a emissão não gera outra guia nem outra chamada', async () => {
    const office = await newOffice();
    const company = await newCompany(office, 'SN');
    const watchId = await newWatch(office, company.id, 'SN');
    await runWatch(office.id, watchId);
    const first = (await watchRow(watchId)).guide_id!;
    const emissions = servicesCalled('GERARDAS12');
    // Volta a rotina para "aguardando": com guia ativa, não emite de novo (RN5).
    await owner.$client.query(`update fiscal_watches set status = 'aguardando' where id = $1`, [
      watchId,
    ]);
    await runWatch(office.id, watchId);
    // Mesmo sem guia ativa, a chave de emissão já deu certo: não chama a Serpro de novo.
    await owner.$client.query(`update guides set status = 'cancelada' where id = $1`, [first]);
    await owner.$client.query(`update fiscal_watches set status = 'aguardando' where id = $1`, [
      watchId,
    ]);
    expect(await runWatch(office.id, watchId)).toBe('nada_a_fazer');
    expect(servicesCalled('GERARDAS12')).toBe(emissions);
    const { rows } = await owner.$client.query('select 1 from guides where tenant_id = $1', [
      office.id,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('storage fora do ar: o erro aparece na rotina, a chamada fica registrada e a próxima tenta de novo', async () => {
    const office = await newOffice();
    const company = await newCompany(office, 'SN');
    const watchId = await newWatch(office, company.id, 'SN');
    const put = deps.storage.put;
    deps.storage.put = () => Promise.reject(new Error('storage indisponível'));
    try {
      expect(await runWatch(office.id, watchId)).toBe('erro');
    } finally {
      deps.storage.put = put;
    }
    const watch = await watchRow(watchId);
    expect(watch).toMatchObject({ status: 'aguardando', guide_id: null });
    expect(watch.last_error).toMatch(/PDF não foi guardado/);
    expect((await callsOf(office.id)).at(-1)).toMatchObject({
      service: 'GERARDAS12',
      status: 'falhou',
      error_kind: 'armazenamento',
    });

    expect(await runWatch(office.id, watchId)).toBe('gerada');
    const calls = (await callsOf(office.id)).filter((c) => c.service === 'GERARDAS12');
    expect(calls).toMatchObject([{ status: 'sucesso' }]);
    expect((await guideRow((await watchRow(watchId)).guide_id!)).status).toBe('publicada');
  });

  it('passou do vencimento sem declaração: desiste e avisa', async () => {
    const office = await newOffice();
    const company = await newCompany(office, 'SN');
    const watchId = await newWatch(office, company.id, 'SN');
    const late = localDateAt(nominalDueDate(PERIOD), 12, TZ);
    late.setUTCDate(late.getUTCDate() + 1);
    deps.serproFake.on('CONSULTIMADECREC14', () => FAKE_ERRORS.naoEncontrado());
    try {
      expect(await runWatch(office.id, watchId, { ...deps, now: () => late })).toBe('desistiu');
    } finally {
      deps.serproFake.on('CONSULTIMADECREC14', null);
    }
    expect((await watchRow(watchId)).status).toBe('desistiu');
    expect(await alertsOf(office.id)).toContainEqual({
      kind: 'declaracao_nao_encontrada',
      resource_id: company.id,
    });
  });

  it('sem procuração: avisa o escritório e tenta no próximo dia útil', async () => {
    const office = await newOffice();
    const company = await newCompany(office, 'SN');
    const watchId = await newWatch(office, company.id, 'SN');
    deps.serproFake.on('CONSULTIMADECREC14', () => ({
      status: 403,
      mensagens: [
        { codigo: 'Erro', texto: 'Procuração eletrônica inexistente para o procurador.' },
      ],
      dados: null,
    }));
    try {
      expect(await runWatch(office.id, watchId)).toBe('erro');
    } finally {
      deps.serproFake.on('CONSULTIMADECREC14', null);
    }
    expect((await watchRow(watchId)).last_error).toMatch(/procuração/);
    expect(await alertsOf(office.id)).toContainEqual({
      kind: 'serpro_procuracao',
      resource_id: company.id,
    });
    expect((await callsOf(office.id))[0]).toMatchObject({
      status: 'falhou',
      error_kind: 'procuracao',
    });
  });
});

describe('DCTFWeb (P24)', () => {
  it('acha o recibo, gera a guia e lê valor e vencimento do PDF', async () => {
    const office = await newOffice();
    const company = await newCompany(office, 'LP');
    const watchId = await newWatch(office, company.id, 'LP');
    // A guia gravada do trial tem a linha zerada: vai para revisão, com valor e data lidos.
    expect(await runWatch(office.id, watchId)).toBe('revisao');
    const guide = await guideRow((await watchRow(watchId)).guide_id!);
    expect(guide).toMatchObject({
      status: 'rascunho',
      amount_cents: '37396',
      due_date: '2027-12-07',
    });
    expect((await callsOf(office.id)).map((c) => c.service)).toEqual([
      'CONSRECIBO32',
      'GERARGUIA31',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Pagamento e recálculo
// ---------------------------------------------------------------------------

async function publishedSimples(office: Office) {
  const company = await newCompany(office, 'SN');
  const watchId = await newWatch(office, company.id, 'SN');
  await runWatch(office.id, watchId);
  const guideId = (await watchRow(watchId)).guide_id!;
  return { company, watchId, guideId };
}

describe('pagamento confirmado na Receita (PAGTOWEB, I5)', () => {
  it('dá baixa, guarda o comprovante e avisa o cliente', async () => {
    const office = await newOffice();
    const { watchId, guideId } = await publishedSimples(office);
    expect(await runWatch(office.id, watchId)).toBe('gerada');
    expect((await guideRow(guideId)).status).toBe('publicada');

    const guide = await guideRow(guideId);
    deps.serproFake.markPaid(guide.external_number!, todayIn(TZ), 5815);
    expect(await runWatch(office.id, watchId)).toBe('paga');
    const paid = await guideRow(guideId);
    expect(paid.status).toBe('paga');
    expect(paid.receipt_storage_key).toMatch(new RegExp(`^tenants/${office.id}/`));
    expect((await watchRow(watchId)).status).toBe('paga');
    const { rows } = await owner.$client.query<{ action: string }>(
      `select action from audit_logs where tenant_id = $1 and resource_id = $2`,
      [office.id, guideId],
    );
    expect(rows.map((r) => r.action)).toContain('guia.baixa_automatica');
    await drainOnly(office.id, ['delivery.plan']);
    const { rows: sent } = await owner.$client.query<{ trigger: string }>(
      'select trigger from deliveries where item_id = $1 order by created_at',
      [guideId],
    );
    expect(sent.map((r) => r.trigger)).toContain('pago');
  });
});

describe('recálculo (RN2, CA2)', () => {
  it('cliente toca "Atualizar guia": guia nova publicada e a antiga substituída', async () => {
    const office = await newOffice();
    const { guideId } = await publishedSimples(office);
    await owner.$client.query(`update guides set status = 'vencida' where id = $1`, [guideId]);
    const token = await linkFor(office.id, guideId);

    const view = await openSecureLink(office.id, token, { requestId: `teste-${randomUUID()}` });
    expect(view).toMatchObject({ state: 'ok', overdue: true, recalculable: true });

    expect(
      await requestRecalcByLink(office.id, token, boss, { requestId: `teste-${randomUUID()}` }),
    ).toBe('pedido');
    await drainOnly(office.id, ['serpro.recalc']);

    const old = await guideRow(guideId);
    expect(old.status).toBe('substituida');
    const { rows } = await owner.$client.query<{ id: string }>(
      'select id from guides where replaces_guide_id = $1',
      [guideId],
    );
    expect(rows).toHaveLength(1);
    const fresh = await guideRow(rows[0]!.id);
    expect(fresh.status).toBe('publicada');
    expect(fresh.external_number).not.toBe(old.external_number);
    const call = deps.serproFake.calls.filter((c) => c.service === 'GERARDAS12').at(-1)!;
    expect(call.dados.dataConsolidacao).toMatch(/^\d{8}$/);
    // O link antigo mostra que a guia foi substituída.
    const after = await openSecureLink(office.id, token, { requestId: `teste-${randomUUID()}` });
    expect(after.state).toBe('substituida');
    expect(
      await requestRecalcByLink(office.id, token, boss, { requestId: `teste-${randomUUID()}` }),
    ).toBe('indisponivel');
  });

  it('guia não vencida e limite de 3 por dia são recusados', async () => {
    const office = await newOffice();
    const { guideId } = await publishedSimples(office);
    const token = await linkFor(office.id, guideId);
    expect(
      await requestRecalcByLink(office.id, token, boss, { requestId: `teste-${randomUUID()}` }),
    ).toBe('indisponivel');
    await owner.$client.query(`update guides set status = 'vencida' where id = $1`, [guideId]);
    for (let i = 0; i < 3; i++)
      await owner.$client.query(
        `insert into fiscal_calls (tenant_id, id, guide_id, system, service, kind, purpose, ambiente, status)
         values ($1, $2, $3, 'PGDASD', 'GERARDAS12', 'emissao', 'recalculo', 'fake', 'falhou')`,
        [office.id, randomUUID(), guideId],
      );
    await expect(requestRecalcByStaff(office.dono(), boss, guideId)).rejects.toThrow(/3 vezes/);
    expect(
      await requestRecalcByLink(office.id, token, boss, { requestId: `teste-${randomUUID()}` }),
    ).toBe('limite');
  });

  it('Receita fora do ar: tenta 3 vezes e vira pedido manual', async () => {
    const office = await newOffice();
    const { guideId } = await publishedSimples(office);
    await owner.$client.query(`update guides set status = 'vencida' where id = $1`, [guideId]);
    const ctx = systemCtx(office.id);
    deps.serproFake.on('GERARDAS12', () => FAKE_ERRORS.indisponivel());
    try {
      const first = await withTenant(ctx, (tx) =>
        runSerproRecalc(tx, ctx, deps, { guideId, requestedBy: 'cliente', attempt: 1 }),
      );
      expect(first).toBe('tentar_de_novo');
      const last = await withTenant(ctx, (tx) =>
        runSerproRecalc(tx, ctx, deps, { guideId, requestedBy: 'cliente', attempt: 3 }),
      );
      expect(last).toBe('pedido_manual');
    } finally {
      deps.serproFake.on('GERARDAS12', null);
    }
    expect((await guideRow(guideId)).status).toBe('vencida');
    expect(await alertsOf(office.id)).toContainEqual({
      kind: 'recalculo_manual',
      resource_id: guideId,
    });
  });
});

// ---------------------------------------------------------------------------
// Disjuntor, custo e "Buscar agora"
// ---------------------------------------------------------------------------

describe('disjuntor por escritório', () => {
  it('5 falhas em 1 minuto pausam as chamadas e avisam o escritório', async () => {
    const office = await newOffice();
    const company = await newCompany(office, 'SN');
    deps.serproFake.on('CONSULTIMADECREC14', () => FAKE_ERRORS.indisponivel());
    try {
      for (let i = 0; i < 5; i++) {
        const watchId = await newWatch(office, company.id, 'SN').catch(async () => {
          const { rows } = await owner.$client.query<{ id: string }>(
            'select id from fiscal_watches where company_id = $1',
            [company.id],
          );
          return rows[0]!.id;
        });
        expect(await runWatch(office.id, watchId)).toBe('erro');
      }
      const before = servicesCalled('CONSULTIMADECREC14');
      const { rows } = await owner.$client.query<{ id: string }>(
        'select id from fiscal_watches where company_id = $1',
        [company.id],
      );
      expect(await runWatch(office.id, rows[0]!.id)).toBe('erro');
      expect(servicesCalled('CONSULTIMADECREC14')).toBe(before);
      expect((await watchRow(rows[0]!.id)).last_error).toMatch(/pausadas/);
    } finally {
      deps.serproFake.on('CONSULTIMADECREC14', null);
    }
    expect((await getFiscalConnectionView(office.dono())).connection?.paused).toBe(true);
    expect((await alertsOf(office.id)).map((a) => a.kind)).toContain('serpro_pausada');
  });
});

describe('custo por escritório', () => {
  it('em produção, cada chamada registra o preço; o painel mostra o consumo do mês', async () => {
    const office = await newOffice();
    const company = await newCompany(office, 'SN');
    const watchId = await newWatch(office, company.id, 'SN');
    const producao: FiscalDeps = { ...deps, serpro: { ...deps.serpro, ambiente: 'producao' } };
    await runWatch(office.id, watchId, producao);
    // Em produção, o modo plataforma primeiro envia o termo (apoio, sem custo).
    expect((await callsOf(office.id)).map((c) => [c.service, c.cost_cents])).toEqual([
      ['ENVIOXMLASSINADO81', 0],
      ['CONSULTIMADECREC14', 24],
      ['GERARDAS12', 32],
    ]);
    expect((await getFiscalConnectionView(office.dono())).usage).toEqual({
      calls: 3,
      costCents: 56,
    });
  });
});

describe('"Buscar agora" na ficha', () => {
  it('enfileira a consulta, mostra a situação e não repete em 10 minutos', async () => {
    const office = await newOffice();
    const company = await newCompany(office, 'SN');
    await requestFiscalCheckNow(office.dono(), boss, company.id);
    await expect(requestFiscalCheckNow(office.dono(), boss, company.id)).rejects.toThrow(
      /poucos minutos/,
    );
    await drainOnly(office.id, ['serpro.watch']);
    const status = await getCompanyFiscalStatus(office.dono(), company.id);
    expect(status.connected).toBe(true);
    expect(status.watches[0]).toMatchObject({
      status: 'gerada',
      kind: 'das_simples',
      period: PERIOD,
    });
    expect(status.calls.map((c) => c.purpose)).toEqual(['buscar_agora', 'buscar_agora']);
  });

  it('atendente não consulta', async () => {
    const office = await newOffice();
    const company = await newCompany(office, 'SN');
    await expect(
      requestFiscalCheckNow(
        memberCtx(office.id, seed.users.atendenteAlfa.id, 'atendente'),
        boss,
        company.id,
      ),
    ).rejects.toThrow(ForbiddenError);
  });
});

// ---------------------------------------------------------------------------
// Isolamento
// ---------------------------------------------------------------------------

describe('isolamento entre escritórios', () => {
  it('outro escritório não vê a conexão, a rotina nem a guia (404 e security_events)', async () => {
    const office = await newOffice();
    const { company, guideId } = await publishedSimples(office);
    const beta = memberCtx(seed.beta.id, seed.users.donoBeta.id, 'dono');

    const view = await getFiscalConnectionView(beta);
    expect(view.connection?.officeCnpj ?? null).not.toBe('44555666000181');

    for (const attempt of [
      () => getCompanyFiscalStatus(beta, company.id),
      () => requestFiscalCheckNow(beta, boss, company.id),
      () => requestRecalcByStaff(beta, boss, guideId),
    ]) {
      const ctx = beta;
      await expect(attempt()).rejects.toThrow(NotFoundError);
      expect(await securityEventsFor(owner, ctx.requestId)).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'resource_not_found' })]),
      );
    }
  });

  it('job do Beta com a rotina do Alfa não chama a Serpro', async () => {
    const office = await newOffice();
    const company = await newCompany(office, 'SN');
    const watchId = await newWatch(office, company.id, 'SN');
    const before = deps.serproFake.calls.length;
    await expect(runWatch(seed.beta.id, watchId)).rejects.toThrow(NotFoundError);
    expect(deps.serproFake.calls.length).toBe(before);
  });

  it('link de um escritório não pede recálculo em outro', async () => {
    const office = await newOffice();
    const { guideId } = await publishedSimples(office);
    await owner.$client.query(`update guides set status = 'vencida' where id = $1`, [guideId]);
    const token = await linkFor(office.id, guideId);
    expect(
      await requestRecalcByLink(seed.beta.id, token, boss, { requestId: `teste-${randomUUID()}` }),
    ).toBe('indisponivel');
  });
});
