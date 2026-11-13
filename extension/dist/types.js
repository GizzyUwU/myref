export const referenceTypes = [
    "book",
    "chapter",
    "journal",
    "website",
    "report",
    "thesis",
    "newspaper",
    "film",
    "other",
];
export const typeLabels = {
    book: "Book",
    chapter: "Chapter",
    journal: "Journal",
    website: "Website",
    report: "Report",
    thesis: "Thesis",
    newspaper: "Newspaper",
    film: "Film",
    other: "Other",
};
export const themes = ["light", "dracula", "macchiato", "mocha"];
export function isTheme(value) {
    return (value === "light" ||
        value === "dracula" ||
        value === "macchiato" ||
        value === "mocha");
}
export function emptyDraft(type = "book") {
    return {
        type,
        title: "",
        authors: [{ family: "", given: "" }],
        editors: [],
        year: "",
        containerTitle: "",
        publisher: "",
        place: "",
        edition: "",
        volume: "",
        issue: "",
        pages: "",
        doi: "",
        url: "",
        accessedDate: null,
        publicationDate: "",
        notes: "",
        tags: [],
    };
}
export function uid() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
}
export function nowIso() {
    return new Date().toISOString();
}
//# sourceMappingURL=types.js.map