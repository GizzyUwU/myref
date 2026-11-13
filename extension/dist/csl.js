import { formatEntries as formatFallback, normDoi, } from "./format.js";
export const defaultStyleId = "harvard-the-university-of-northampton";
export const defaultStyleTitle = "The University of Northampton (author-date/Harvard)";
export const bundledStyles = [
    { id: "harvard-the-university-of-northampton", title: "The University of Northampton (author-date/Harvard)" },
    { id: "apa", title: "APA Style 7th edition" },
    { id: "modern-language-association", title: "MLA Handbook 9th edition (in-text citations)" },
    { id: "chicago-author-date", title: "Chicago Manual of Style 18th edition (author-date)" },
    { id: "ieee", title: "IEEE Reference Guide" },
    { id: "vancouver", title: "NLM/Vancouver: Citing Medicine 2nd edition (citation-sequence)" },
];
export function defaultStyle() {
    return { styleId: defaultStyleId, styleTitle: defaultStyleTitle };
}
export async function loadBundledStyle(id) {
    const bundled = bundledStyles.find((style) => style.id === id);
    if (!bundled)
        return null;
    try {
        const [xmlRes, localeRes] = await Promise.all([
            fetch(chrome.runtime.getURL(`csl/${id}.xml`)),
            fetch(chrome.runtime.getURL("csl/locales-en-US.xml")),
        ]);
        if (!xmlRes.ok || !localeRes.ok)
            return null;
        const [xml, localeXml] = await Promise.all([xmlRes.text(), localeRes.text()]);
        if (!/<style\b/i.test(xml))
            return null;
        return { title: bundled.title, xml, locales: { "en-US": localeXml } };
    }
    catch {
        return null;
    }
}
const cslTypes = {
    book: "book",
    chapter: "chapter",
    journal: "article-journal",
    website: "webpage",
    report: "report",
    thesis: "thesis",
    newspaper: "article-newspaper",
    film: "motion_picture",
    other: "article",
};
function dateParts(value) {
    if (!value)
        return undefined;
    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso)
        return [[Number(iso[1]), Number(iso[2]), Number(iso[3])]];
    const year = value.match(/\d{4}/);
    return year ? [[Number(year[0])]] : undefined;
}
function cslNames(authors) {
    return (authors ?? [])
        .map((author) => {
        const family = (author.family ?? "").trim();
        const given = (author.given ?? "").trim();
        return given ? { family, given } : { family };
    })
        .filter((author) => author.family);
}
function toCslItem(row) {
    const item = { id: row.id, type: cslTypes[row.type] ?? "article" };
    if (row.title.trim())
        item.title = row.title.trim();
    const authors = cslNames(row.authors);
    if (authors.length)
        item.author = authors;
    const editors = cslNames(row.editors);
    if (editors.length)
        item.editor = editors;
    const issued = dateParts(row.year) ?? dateParts(row.publicationDate);
    if (issued)
        item.issued = { "date-parts": issued };
    if (row.containerTitle.trim())
        item["container-title"] = row.containerTitle.trim();
    if (row.publisher.trim())
        item.publisher = row.publisher.trim();
    if (row.place.trim())
        item["publisher-place"] = row.place.trim();
    if (row.edition.trim())
        item.edition = row.edition.trim();
    if (row.volume.trim())
        item.volume = row.volume.trim();
    if (row.issue.trim())
        item.issue = row.issue.trim();
    if (row.pages.trim())
        item.page = row.pages.trim();
    const doi = normDoi(row.doi);
    if (doi)
        item.DOI = doi;
    if (row.url.trim())
        item.URL = row.url.trim();
    const accessed = dateParts(row.accessedDate);
    if (accessed)
        item.accessed = { "date-parts": accessed };
    if (row.type === "thesis")
        item.genre = "Thesis";
    return item;
}
function decodeEntities(value) {
    return value
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
        .replace(/&amp;/g, "&");
}
function stripEntryWrapper(entry) {
    let value = entry.trim();
    if (value.startsWith('<div class="csl-entry">')) {
        value = value.slice('<div class="csl-entry">'.length);
    }
    if (value.endsWith("</div>"))
        value = value.slice(0, -"</div>".length);
    return value.trim();
}
function htmlToPlain(html) {
    return decodeEntities(html
        .replace(/<\/(?:div|p|li|h[1-6])>/gi, " ")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<[^>]+>/g, ""))
        .replace(/\s+/g, " ")
        .trim();
}
export function renderCsl(refs, doc) {
    try {
        if (refs.length === 0)
            return [];
        if (typeof CSL === "undefined")
            return null;
        const items = {};
        for (const row of refs)
            items[row.id] = toCslItem(row);
        const engine = new CSL.Engine({
            retrieveLocale: (lang) => doc.locales[lang] ?? doc.locales["en-US"] ?? "",
            retrieveItem: (id) => items[id],
        }, doc.xml);
        engine.setOutputFormat("html");
        engine.updateItems(refs.map((row) => row.id));
        const bibliography = engine.makeBibliography();
        if (!bibliography)
            return null;
        const [meta, rawEntries] = bibliography;
        const typeById = new Map(refs.map((row) => [row.id, row.type]));
        const entries = meta.entry_ids
            .map((group, index) => {
            const id = group[0];
            if (!id)
                return null;
            const html = stripEntryWrapper(rawEntries[index] ?? "");
            const plain = htmlToPlain(html);
            if (!plain)
                return null;
            return { id, type: typeById.get(id) ?? "other", plain, html };
        })
            .filter((entry) => entry !== null);
        const citations = entries.map((entry) => ({
            id: entry.id,
            inText: htmlToPlain(engine.makeCitationCluster([{ id: entry.id }])),
        }));
        const inTextById = new Map(citations.map((citation) => [citation.id, citation.inText]));
        return entries.map((entry) => ({
            id: entry.id,
            plain: entry.plain,
            html: entry.html,
            inText: inTextById.get(entry.id) ?? "",
        }));
    }
    catch {
        return null;
    }
}
export function formatWithStyle(refs, doc) {
    if (doc) {
        const rendered = renderCsl(refs, doc);
        if (rendered)
            return rendered;
    }
    return formatFallback(refs);
}
//# sourceMappingURL=csl.js.map