import { ref, watch, type Ref } from "vue";

export function useLocalState<T>(key: string, defaultValue: T): Ref<T> {
	const stored = localStorage.getItem(key);
	let initial = defaultValue;
	if (stored !== null) {
		try {
			initial = JSON.parse(stored) as T;
		} catch {
			// corrupt value — fall back to default
		}
	}

	const state = ref(initial) as Ref<T>;

	watch(
		state,
		(value) => {
			if (value === null || value === undefined) {
				localStorage.removeItem(key);
			} else {
				localStorage.setItem(key, JSON.stringify(value));
			}
		},
		{ deep: true },
	);

	return state;
}
