export const initialState = () => ({
  view: "story",
  objectiveId: "",
  groupBy: "task",
  query: "",
  selected: null,
  selectedLine: null,
  layout: "unified",
  follow: false,
  detail: false,
  historyId: "",
  scroll: {},
});
export function reduceReview(state, action) {
  switch (action.type) {
    case "select":
      return {
        ...state,
        selected: action.id,
        selectedLine: null,
        detail: true,
      };
    case "view":
      return { ...state, view: action.view, detail: false };
    case "incoming":
      return state.follow
        ? {
            ...state,
            selected: action.snapshot.hunks.at(-1)?.id ?? null,
            historyId: "",
          }
        : state;
    default:
      return { ...state, ...action.patch };
  }
}
export function restoreState(storage, key) {
  try {
    return {
      ...initialState(),
      ...JSON.parse(storage.getItem(key) ?? "{}"),
      follow: false,
    };
  } catch {
    return initialState();
  }
}
