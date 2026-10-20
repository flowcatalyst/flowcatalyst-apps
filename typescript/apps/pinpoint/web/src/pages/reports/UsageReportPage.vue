<script setup lang="ts">
/**
 * Usage — API requests per client / partition / operation by month, week or
 * day, from the request log. Headline tiles, requests-per-period chart, a
 * breakdown table (CSV export), and the individual requests behind it with
 * their input and output. The server limits everything to the clients and
 * partitions the signed-in user has access to.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { api, ok, type ApiResponse } from '@/api/client';
import { useClientStore } from '@/stores/client';
import UsageChart, { type UsagePoint } from '@/components/reports/UsageChart.vue';
import {
  addDay,
  localDate,
  periodEnd,
  periodLabel,
  periodRange,
  periodTitle,
  zonedMidnight,
  type UsagePeriod,
} from '@/lib/usage-periods';

type UsageReport = ApiResponse<'/bff/reports/usage', 'get'>;
type UsageRow = UsageReport['rows'][number];
type RequestLogPage = ApiResponse<'/bff/request-logs', 'get'>;
type RequestLogSummary = RequestLogPage['entries'][number];
type RequestLogDetail = ApiResponse<'/bff/request-logs/{id}', 'get'>;
type Partition = ApiResponse<'/bff/clients/{clientId}/partitions', 'get'>['items'][number];

const clientStore = useClientStore();
const clients = computed(() => clientStore.clients ?? []);
const clientName = (id: string | null, code?: string | null) =>
  id === null ? '—' : (clients.value.find((c) => c.id === id)?.name ?? code ?? id);

// ── Filters ─────────────────────────────────────────────────────────────────
const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const timezones = [...new Set([browserZone, 'Africa/Johannesburg', 'UTC'])];
const periodOptions = [
  { label: 'Month', value: 'month' },
  { label: 'Week', value: 'week' },
  { label: 'Day', value: 'day' },
];

const period = ref<UsagePeriod>('month');
const timezone = ref(browserZone);
const range = ref<(Date | null)[] | null>(null);
const clientId = ref<string | null>(null);
const partitionId = ref<string | null>(null);
const operation = ref<string | null>(null);
const partitions = ref<Partition[]>([]);

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** The picked date range as instants in the report timezone (end exclusive). */
const dateWindow = computed(() => {
  const [start, end] = range.value ?? [];
  if (!start) return { from: undefined, to: undefined };
  const last = ymd(end ?? start);
  return {
    from: zonedMidnight(ymd(start), timezone.value).toISOString(),
    to: zonedMidnight(addDay(last), timezone.value).toISOString(),
  };
});

const filters = computed(() => ({
  ...(clientId.value ? { clientId: clientId.value } : {}),
  ...(partitionId.value ? { partitionId: partitionId.value } : {}),
  ...(operation.value ? { operation: operation.value } : {}),
}));

// ── Usage report ────────────────────────────────────────────────────────────
const report = ref<UsageReport | null>(null);
const loading = ref(false);
const operations = ref<string[]>([]);

async function loadReport(): Promise<void> {
  loading.value = true;
  try {
    report.value = await ok(
      api.GET('/bff/reports/usage', {
        params: {
          query: {
            period: period.value,
            timezone: timezone.value,
            ...(dateWindow.value.from
              ? { from: dateWindow.value.from, to: dateWindow.value.to }
              : {}),
            ...filters.value,
          },
        },
      }),
    );
    if (!operation.value) {
      operations.value = [...new Set(report.value.rows.map((r) => r.operation))].toSorted();
    }
  } catch {
    report.value = null;
  } finally {
    loading.value = false;
  }
}

async function loadPartitions(): Promise<void> {
  partitions.value = [];
  if (!clientId.value) return;
  try {
    partitions.value = (
      await ok(
        api.GET('/bff/clients/{clientId}/partitions', {
          params: { path: { clientId: clientId.value } },
        }),
      )
    ).items;
  } catch {
    /* optional */
  }
}

const rows = computed<UsageRow[]>(() => report.value?.rows ?? []);

const points = computed<UsagePoint[]>(() => {
  if (!report.value) return [];
  const byPeriod = new Map<string, { requests: number; errors: number }>();
  for (const r of rows.value) {
    const acc = byPeriod.get(r.periodStart) ?? { requests: 0, errors: 0 };
    acc.requests += r.requests;
    acc.errors += r.errors;
    byPeriod.set(r.periodStart, acc);
  }
  const from = localDate(new Date(report.value.from), timezone.value);
  const to = localDate(new Date(new Date(report.value.to).getTime() - 1), timezone.value);
  return periodRange(from, to, period.value).map((start) => ({
    start,
    label: periodLabel(start, period.value),
    title: periodTitle(start, period.value),
    requests: byPeriod.get(start)?.requests ?? 0,
    errors: byPeriod.get(start)?.errors ?? 0,
  }));
});

const fmt = new Intl.NumberFormat('en-GB');
const totals = computed(() => {
  const requests = rows.value.reduce((n, r) => n + r.requests, 0);
  const errors = rows.value.reduce((n, r) => n + r.errors, 0);
  const busiest = points.value.reduce<UsagePoint | null>(
    (best, p) => (p.requests > (best?.requests ?? 0) ? p : best),
    null,
  );
  return {
    requests,
    errors,
    errorRate: requests > 0 ? (errors / requests) * 100 : 0,
    clients: new Set(rows.value.map((r) => r.clientId).filter(Boolean)).size,
    busiest,
  };
});

const windowLabel = computed(() => {
  if (!report.value) return '';
  const from = localDate(new Date(report.value.from), timezone.value);
  const to = localDate(new Date(new Date(report.value.to).getTime() - 1), timezone.value);
  return `${from} → ${to} (${timezone.value})`;
});

// ── CSV export of the breakdown ─────────────────────────────────────────────
function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCsv(): void {
  const header = [
    'period_start',
    'client_code',
    'client_id',
    'partition_code',
    'partition_id',
    'operation',
    'requests',
    'errors',
  ];
  const lines = rows.value.map((r) =>
    [
      r.periodStart,
      r.clientCode,
      r.clientId,
      r.partitionCode,
      r.partitionId,
      r.operation,
      r.requests,
      r.errors,
    ]
      .map(csvCell)
      .join(','),
  );
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `pinpoint-usage-${period.value}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

// ── Requests (drill-down) ───────────────────────────────────────────────────
const tab = ref<'breakdown' | 'requests'>('breakdown');
const requests = ref<RequestLogSummary[]>([]);
const requestsTotal = ref(0);
const requestsLoading = ref(false);
const requestsOffset = ref(0);
const REQUESTS_PAGE = 50;
/** Narrower than the page filters when drilled into one period / row. */
const drill = ref<{
  from?: string;
  to?: string;
  clientId?: string;
  partitionId?: string;
  operation?: string;
  label: string;
} | null>(null);

async function loadRequests(): Promise<void> {
  requestsLoading.value = true;
  const { label: _label, ...narrow } = drill.value ?? { label: '' };
  try {
    const page = await ok(
      api.GET('/bff/request-logs', {
        params: {
          query: {
            ...(dateWindow.value.from
              ? { from: dateWindow.value.from, to: dateWindow.value.to }
              : {}),
            ...filters.value,
            ...narrow,
            limit: REQUESTS_PAGE,
            offset: requestsOffset.value,
          },
        },
      }),
    );
    requests.value = page.entries;
    requestsTotal.value = page.total;
  } catch {
    requests.value = [];
    requestsTotal.value = 0;
  } finally {
    requestsLoading.value = false;
  }
}

function periodBounds(start: string): { from: string; to: string } {
  return {
    from: zonedMidnight(start, timezone.value).toISOString(),
    to: zonedMidnight(periodEnd(start, period.value), timezone.value).toISOString(),
  };
}

function drillIntoPeriod(point: UsagePoint): void {
  drill.value = { ...periodBounds(point.start), label: point.title };
  showRequests();
}

function drillIntoRow(row: UsageRow): void {
  drill.value = {
    ...periodBounds(row.periodStart),
    ...(row.clientId ? { clientId: row.clientId } : {}),
    ...(row.partitionId ? { partitionId: row.partitionId } : {}),
    operation: row.operation,
    label: `${periodTitle(row.periodStart, period.value)} · ${clientName(row.clientId, row.clientCode)} · ${row.operation}`,
  };
  showRequests();
}

function showRequests(): void {
  requestsOffset.value = 0;
  tab.value = 'requests';
  void loadRequests();
}

function clearDrill(): void {
  drill.value = null;
  showRequests();
}

function onRequestsPage(event: { first: number }): void {
  requestsOffset.value = event.first;
  void loadRequests();
}

const detail = ref<RequestLogDetail | null>(null);
const detailOpen = ref(false);
async function openDetail(id: string): Promise<void> {
  detail.value = null;
  detailOpen.value = true;
  try {
    detail.value = await ok(api.GET('/bff/request-logs/{id}', { params: { path: { id } } }));
  } catch {
    detailOpen.value = false;
  }
}

const pretty = (value: unknown) =>
  value === null || value === undefined ? '—' : JSON.stringify(value, null, 2);
const when = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone.value,
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(iso));
const statusSeverity = (code: number) =>
  code >= 500 ? 'danger' : code >= 400 ? 'warn' : 'success';

// ── Wiring ──────────────────────────────────────────────────────────────────
function reload(): void {
  void loadReport();
  if (tab.value === 'requests') {
    requestsOffset.value = 0;
    void loadRequests();
  }
}

onMounted(async () => {
  if (clients.value.length === 0) await clientStore.loadClients();
  void loadReport();
});
watch(clientId, () => {
  partitionId.value = null;
  void loadPartitions();
});
watch([period, timezone, range, clientId, partitionId, operation], reload);
watch(tab, (t) => {
  if (t === 'requests' && requests.value.length === 0) void loadRequests();
});
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <div>
        <h1 class="page-title">Usage</h1>
        <p class="page-subtitle">API requests per client, partition and operation</p>
      </div>
    </div>

    <!-- Filters: one row above the charts -->
    <div class="filters fc-card">
      <SelectButton
        v-model="period"
        :options="periodOptions"
        option-label="label"
        option-value="value"
        :allow-empty="false"
      />
      <DatePicker
        v-model="range"
        selection-mode="range"
        :manual-input="false"
        show-button-bar
        placeholder="Default window"
        date-format="yy-mm-dd"
        style="width: 220px"
      />
      <Select
        v-model="clientId"
        :options="[{ id: null, name: 'All clients' }, ...clients]"
        option-label="name"
        option-value="id"
        placeholder="All clients"
        filter
        style="width: 200px"
      />
      <Select
        v-if="clientId && partitions.length > 0"
        v-model="partitionId"
        :options="[{ id: null, name: 'All partitions' }, ...partitions]"
        option-label="name"
        option-value="id"
        placeholder="All partitions"
        style="width: 180px"
      />
      <Select
        v-model="operation"
        :options="[
          { value: null, label: 'All operations' },
          ...operations.map((o) => ({ value: o, label: o })),
        ]"
        option-label="label"
        option-value="value"
        placeholder="All operations"
        style="width: 200px"
      />
      <Select v-model="timezone" :options="timezones" style="width: 190px" />
    </div>

    <!-- Headline tiles -->
    <div class="tiles">
      <div class="fc-card tile">
        <div class="tile-label">Requests</div>
        <div class="tile-value">{{ fmt.format(totals.requests) }}</div>
        <div class="tile-note">{{ windowLabel }}</div>
      </div>
      <div class="fc-card tile">
        <div class="tile-label">Errors</div>
        <div class="tile-value">{{ fmt.format(totals.errors) }}</div>
        <div class="tile-note">{{ totals.errorRate.toFixed(1) }}% of requests (4xx / 5xx)</div>
      </div>
      <div class="fc-card tile">
        <div class="tile-label">Clients</div>
        <div class="tile-value">{{ fmt.format(totals.clients) }}</div>
        <div class="tile-note">with at least one request</div>
      </div>
      <div class="fc-card tile">
        <div class="tile-label">Busiest {{ period }}</div>
        <div class="tile-value">
          {{ totals.busiest ? fmt.format(totals.busiest.requests) : '—' }}
        </div>
        <div class="tile-note">{{ totals.busiest?.title ?? 'no requests' }}</div>
      </div>
    </div>

    <div class="fc-card chart-card">
      <div class="card-title">Requests per {{ period }}</div>
      <div v-if="loading && !report" class="empty">Loading…</div>
      <div v-else-if="totals.requests === 0" class="empty">No requests in this window.</div>
      <UsageChart v-else :points="points" @select="drillIntoPeriod" />
      <div v-if="totals.requests > 0" class="hint">Click a {{ period }} to see its requests.</div>
    </div>

    <div class="fc-card">
      <Tabs v-model:value="tab">
        <TabList>
          <Tab value="breakdown">Breakdown</Tab>
          <Tab value="requests">Requests</Tab>
        </TabList>
        <TabPanels>
          <TabPanel value="breakdown">
            <div class="table-actions">
              <Button
                label="Export CSV"
                icon="pi pi-download"
                severity="secondary"
                size="small"
                :disabled="rows.length === 0"
                @click="exportCsv"
              />
            </div>
            <DataTable
              :value="rows"
              :loading="loading"
              :paginator="rows.length > 25"
              :rows="25"
              sort-mode="single"
              row-hover
              class="clickable"
              @row-click="drillIntoRow($event.data as UsageRow)"
            >
              <Column field="periodStart" header="Period" sortable>
                <template #body="{ data }">{{
                  periodTitle((data as UsageRow).periodStart, period)
                }}</template>
              </Column>
              <Column header="Client" sortable sort-field="clientCode">
                <template #body="{ data }">
                  {{ clientName((data as UsageRow).clientId, (data as UsageRow).clientCode) }}
                </template>
              </Column>
              <Column header="Partition" sortable sort-field="partitionCode">
                <template #body="{ data }">{{ (data as UsageRow).partitionCode ?? '—' }}</template>
              </Column>
              <Column field="operation" header="Operation" sortable />
              <Column field="requests" header="Requests" sortable class="num">
                <template #body="{ data }">{{ fmt.format((data as UsageRow).requests) }}</template>
              </Column>
              <Column field="errors" header="Errors" sortable class="num">
                <template #body="{ data }">{{ fmt.format((data as UsageRow).errors) }}</template>
              </Column>
              <template #empty>
                <div class="empty">No requests in this window.</div>
              </template>
            </DataTable>
          </TabPanel>
          <TabPanel value="requests">
            <div v-if="drill" class="drill">
              <span
                >Showing <strong>{{ drill.label }}</strong></span
              >
              <Button label="Show all" link size="small" @click="clearDrill" />
            </div>
            <DataTable
              :value="requests"
              :loading="requestsLoading"
              lazy
              paginator
              :rows="REQUESTS_PAGE"
              :total-records="requestsTotal"
              :first="requestsOffset"
              row-hover
              class="clickable"
              @page="onRequestsPage"
              @row-click="openDetail(($event.data as RequestLogSummary).id)"
            >
              <Column header="Time">
                <template #body="{ data }">{{
                  when((data as RequestLogSummary).createdAt)
                }}</template>
              </Column>
              <Column field="operation" header="Operation" />
              <Column header="Client">
                <template #body="{ data }">{{
                  clientName((data as RequestLogSummary).clientId)
                }}</template>
              </Column>
              <Column header="Status">
                <template #body="{ data }">
                  <Tag
                    :value="String((data as RequestLogSummary).statusCode)"
                    :severity="statusSeverity((data as RequestLogSummary).statusCode)"
                  />
                </template>
              </Column>
              <Column header="Duration" class="num">
                <template #body="{ data }"
                  >{{ fmt.format((data as RequestLogSummary).durationMs) }} ms</template
                >
              </Column>
              <template #empty>
                <div class="empty">No requests.</div>
              </template>
            </DataTable>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </div>

    <Dialog
      v-model:visible="detailOpen"
      modal
      header="Request"
      :style="{ width: 'min(960px, 95vw)' }"
    >
      <div v-if="!detail" class="empty">Loading…</div>
      <template v-else>
        <dl class="meta">
          <dt>Time</dt>
          <dd>{{ when(detail.createdAt) }}</dd>
          <dt>Operation</dt>
          <dd>{{ detail.operation }}</dd>
          <dt>Request</dt>
          <dd>
            <code>{{ detail.method }} {{ detail.url }}</code>
          </dd>
          <dt>Status</dt>
          <dd>
            <Tag :value="String(detail.statusCode)" :severity="statusSeverity(detail.statusCode)" />
          </dd>
          <dt>Duration</dt>
          <dd>{{ fmt.format(detail.durationMs) }} ms</dd>
          <dt>Client</dt>
          <dd>{{ clientName(detail.clientId) }}</dd>
          <dt>Partition</dt>
          <dd>{{ detail.partitionId ?? '—' }}</dd>
          <dt>Caller</dt>
          <dd>{{ detail.principalId ?? '—' }}</dd>
        </dl>
        <div class="bodies">
          <div>
            <div class="card-title">Input</div>
            <pre>{{ pretty(detail.requestBody) }}</pre>
          </div>
          <div>
            <div class="card-title">Output</div>
            <pre>{{ pretty(detail.responseBody) }}</pre>
          </div>
        </div>
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 16px;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}
.tile-label {
  color: #627d98;
  font-size: 13px;
  text-transform: capitalize;
}
.tile-value {
  font-size: 28px;
  font-weight: 600;
  color: #102a43;
  margin: 4px 0;
  font-variant-numeric: tabular-nums;
}
.tile-note {
  color: #627d98;
  font-size: 12px;
}
.chart-card {
  margin-bottom: 16px;
}
.card-title {
  font-weight: 600;
  color: #102a43;
  margin-bottom: 12px;
}
.hint {
  color: #627d98;
  font-size: 12px;
  margin-top: 4px;
}
.empty {
  text-align: center;
  padding: 48px;
  color: #627d98;
}
.table-actions {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}
.drill {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  color: #334e68;
}
.clickable :deep(tbody tr) {
  cursor: pointer;
}
:deep(.num) {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.meta {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 6px 16px;
  margin: 0 0 16px;
}
.meta dt {
  color: #627d98;
}
.meta dd {
  margin: 0;
}
.bodies {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 16px;
}
pre {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 12px;
  max-height: 420px;
  overflow: auto;
  font-size: 12px;
  margin: 0;
}
</style>
