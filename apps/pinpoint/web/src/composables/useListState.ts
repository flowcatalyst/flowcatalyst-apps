import { ref, computed, watch, type Ref } from "vue";
import { useRouter, useRoute } from "vue-router";

interface StringFilter {
	type: "string";
	queryKey: string;
	default?: string | null;
}

interface StringArrayFilter {
	type: "string[]";
	queryKey: string;
	default?: string[];
}

interface NumberFilter {
	type: "number";
	queryKey: string;
	default?: number | null;
}

type FilterDef = StringFilter | StringArrayFilter | NumberFilter;

type FilterValue<F extends FilterDef> = F extends StringArrayFilter
	? string[]
	: F extends NumberFilter
		? number | null
		: string | null;

type FilterRefs<T extends Record<string, FilterDef>> = {
	[K in keyof T]: Ref<FilterValue<T[K]>>;
};

interface ListStateConfig<T extends Record<string, FilterDef>> {
	filters?: T;
	pagination?: { defaultPage?: number; defaultPageSize?: number } | false;
	sort?:
		| { defaultField?: string; defaultOrder?: "asc" | "desc" }
		| false;
	search?: { queryKey?: string; debounceMs?: number } | false;
}

const PAGE_KEY = "p";
const PAGE_SIZE_KEY = "ps";
const SORT_FIELD_KEY = "sf";
const SORT_ORDER_KEY = "so";
const DEFAULT_SEARCH_KEY = "q";

function parseQueryArray(value: unknown): string[] {
	if (!value) return [];
	if (Array.isArray(value))
		return value.filter((v): v is string => typeof v === "string");
	if (typeof value === "string") return value.split(",").filter(Boolean);
	return [];
}

function parseQueryString(value: unknown): string | null {
	if (typeof value === "string" && value.length > 0) return value;
	return null;
}

function parseQueryNumber(value: unknown): number | null {
	if (typeof value === "string") {
		const n = Number(value);
		if (!Number.isNaN(n)) return n;
	}
	return null;
}

export function useListState<T extends Record<string, FilterDef>>(
	config: ListStateConfig<T> = {},
) {
	const router = useRouter();
	const route = useRoute();

	const filterDefs = (config.filters ?? {}) as T;

	const filters = {} as FilterRefs<T>;
	for (const [key, def] of Object.entries(filterDefs)) {
		const queryValue = route.query[def.queryKey];
		switch (def.type) {
			case "string[]":
				(filters as Record<string, Ref>)[key] = ref(
					parseQueryArray(queryValue).length > 0
						? parseQueryArray(queryValue)
						: (def.default ?? []),
				);
				break;
			case "number":
				(filters as Record<string, Ref>)[key] = ref(
					parseQueryNumber(queryValue) ?? (def.default ?? null),
				);
				break;
			case "string":
			default:
				(filters as Record<string, Ref>)[key] = ref(
					parseQueryString(queryValue) ?? (def.default ?? null),
				);
				break;
		}
	}

	const paginationConfig =
		config.pagination === false
			? null
			: {
					defaultPage: config.pagination?.defaultPage ?? 0,
					defaultPageSize: config.pagination?.defaultPageSize ?? 100,
				};

	const page = ref(
		paginationConfig
			? (parseQueryNumber(route.query[PAGE_KEY]) ?? paginationConfig.defaultPage)
			: 0,
	);
	const pageSize = ref(
		paginationConfig
			? (parseQueryNumber(route.query[PAGE_SIZE_KEY]) ??
				paginationConfig.defaultPageSize)
			: 100,
	);

	const sortConfig =
		config.sort === false
			? null
			: {
					defaultField: config.sort?.defaultField ?? "",
					defaultOrder: (config.sort?.defaultOrder ?? "desc") as
						| "asc"
						| "desc",
				};

	const sortField = ref(
		sortConfig
			? (parseQueryString(route.query[SORT_FIELD_KEY]) ??
				sortConfig.defaultField)
			: "",
	);
	const sortOrder = ref<"asc" | "desc">(
		sortConfig
			? ((parseQueryString(route.query[SORT_ORDER_KEY]) as
					| "asc"
					| "desc"
					| null) ?? sortConfig.defaultOrder)
			: "desc",
	);

	const searchConfig =
		config.search === false
			? null
			: {
					queryKey: config.search?.queryKey ?? DEFAULT_SEARCH_KEY,
					debounceMs: config.search?.debounceMs ?? 300,
				};

	const searchQuery = ref(
		searchConfig
			? (parseQueryString(route.query[searchConfig.queryKey]) ?? "")
			: "",
	);

	let suppressSync = false;

	function buildQuery(): Record<string, string | undefined> {
		const query: Record<string, string | undefined> = {};

		for (const [key, def] of Object.entries(filterDefs)) {
			const value = (filters as Record<string, Ref>)[key]?.value as unknown;
			switch (def.type) {
				case "string[]":
					if (Array.isArray(value) && value.length > 0)
						query[def.queryKey] = (value as string[]).join(",");
					break;
				case "number":
					if (value !== null && value !== undefined && value !== (def.default ?? null))
						query[def.queryKey] = String(value);
					break;
				case "string":
				default:
					if (value) query[def.queryKey] = value as string;
					break;
			}
		}

		if (paginationConfig) {
			if (page.value !== paginationConfig.defaultPage)
				query[PAGE_KEY] = String(page.value);
			if (pageSize.value !== paginationConfig.defaultPageSize)
				query[PAGE_SIZE_KEY] = String(pageSize.value);
		}

		if (sortConfig) {
			if (sortField.value && sortField.value !== sortConfig.defaultField)
				query[SORT_FIELD_KEY] = sortField.value;
			if (sortOrder.value !== sortConfig.defaultOrder)
				query[SORT_ORDER_KEY] = sortOrder.value;
		}

		if (searchConfig && searchQuery.value)
			query[searchConfig.queryKey] = searchQuery.value;

		return query;
	}

	function syncToUrl() {
		if (suppressSync) return;
		void router.replace({ query: buildQuery() });
	}

	function setSilent<K extends keyof typeof filters>(
		key: K,
		value: (typeof filters)[K]["value"],
	) {
		suppressSync = true;
		const r = (filters as Record<string, Ref>)[key as string];
		if (r) r.value = value;
		suppressSync = false;
	}

	const allFilterRefs = Object.values(filters) as Ref[];

	if (allFilterRefs.length > 0) {
		watch(allFilterRefs, syncToUrl, { deep: true });
	}

	watch([page, pageSize, sortField, sortOrder], syncToUrl);

	if (searchConfig) {
		let searchTimer: ReturnType<typeof setTimeout> | undefined;
		watch(searchQuery, () => {
			clearTimeout(searchTimer);
			searchTimer = setTimeout(syncToUrl, searchConfig.debounceMs);
		});
	}

	const hasActiveFilters = computed(() => {
		for (const [key, def] of Object.entries(filterDefs)) {
			const value = (filters as Record<string, Ref>)[key]?.value as unknown;
			switch (def.type) {
				case "string[]":
					if (Array.isArray(value) && value.length > 0) return true;
					break;
				case "number":
					if (value !== null && value !== (def.default ?? null))
						return true;
					break;
				case "string":
				default:
					if (value) return true;
					break;
			}
		}
		if (searchConfig && searchQuery.value) return true;
		return false;
	});

	function clearFilters() {
		suppressSync = true;
		for (const [key, def] of Object.entries(filterDefs)) {
			const r = (filters as Record<string, Ref>)[key];
			if (!r) continue;
			switch (def.type) {
				case "string[]":
					r.value = def.default ?? [];
					break;
				case "number":
					r.value = def.default ?? null;
					break;
				case "string":
				default:
					r.value = def.default ?? null;
					break;
			}
		}
		if (searchConfig) searchQuery.value = "";
		if (paginationConfig) page.value = paginationConfig.defaultPage;
		suppressSync = false;
		syncToUrl();
	}

	function onPage(event: { page: number; rows: number }) {
		page.value = event.page;
		pageSize.value = event.rows;
	}

	function onSort(event: { sortField: string; sortOrder: number }) {
		sortField.value = event.sortField;
		sortOrder.value = event.sortOrder === 1 ? "asc" : "desc";
	}

	function resetPage() {
		if (paginationConfig) page.value = paginationConfig.defaultPage;
	}

	const first = computed(() => page.value * pageSize.value);

	return {
		filters,
		page,
		pageSize,
		first,
		sortField,
		sortOrder,
		searchQuery,
		hasActiveFilters,
		clearFilters,
		resetPage,
		onPage,
		onSort,
		setSilent,
		syncToUrl,
	};
}
