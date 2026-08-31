const supported=["en","zh-CN","zh-TW","ja","ko","es","fr","de","pt","ru","ar","id"];
const requested=new URLSearchParams(location.search).get("lang"),stored=localStorage.getItem("ynx.video.locale");
let locale="en";
if (supported.includes(stored)) locale=stored;
if (supported.includes(requested)) locale=requested;
let catalog={};
// Resolve from this module so the public viewer stays under /video/. An
// origin-root URL is wrong behind the shared web4 router.
const catalogURL=new URL("./i18n/catalog.json",import.meta.url);
export const ready=fetch(catalogURL).then(response=>{if(!response.ok)throw new Error("i18n unavailable");return response.json()}).then(data=>{catalog=data;apply();return data});
export function t(key){return catalog[locale]?.[key]||catalog.en?.[key]||key}
function apply(){document.documentElement.lang=locale;document.documentElement.dir=locale==="ar"?"rtl":"ltr";document.querySelectorAll("[data-i18n]").forEach(node=>node.textContent=t(node.dataset.i18n));document.querySelectorAll("[data-i18n-placeholder]").forEach(node=>node.setAttribute("placeholder",t(node.dataset.i18nPlaceholder)));const select=document.querySelector("#locale");if(!select)return;select.replaceChildren(...supported.map(code=>new Option(code,code)));select.value=locale;select.setAttribute("aria-label",t("language"));select.onchange=()=>{localStorage.setItem("ynx.video.locale",select.value);location.reload()}}
