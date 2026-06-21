// Standalone OXXO invoice + delivery runner.
//
// Drives the OXXO facturación portal end-to-end for a ticket, generates the CFDI,
// collects the PDF + XML off the download screen, uploads both to R2, and writes
// invoice.cfdi (+ status "done") onto the Ticket so the dashboard shows it as
// facturado with downloads. Mirrors the engine modules (libs/engine/portals/oxxo.js,
// libs/engine/delivery.js, libs/engine/nodes/deliverInvoice.js) but self-contained
// (no "@/" aliases / mongoose) so it runs as a plain node script.
//
// Run (node 22, reads env from .env.local):
//   Full flow (GENERATES a real CFDI — burns one factura):
//     node --env-file=.env.local scripts/oxxo-deliver.mjs <ticketId>
//   Deliver pre-downloaded files only (no portal, no factura burned):
//     node --env-file=.env.local scripts/oxxo-deliver.mjs --files <pdf> <xml> <ticketId>

import fs from "fs";
import { MongoClient } from "mongodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const PORTAL =
  "https://www4.oxxo.com:9443/facturacionElectronica-web/views/layout/inicio.do";
const MONTHS_ES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const REGIMEN_MATCH = { "601":"General de Ley Personas Morales","603":"Fines no Lucrativos","605":"Sueldos y Salarios","606":"Arrendamiento","607":"Demás ingresos","610":"Residentes en el Extranjero","611":"Dividendos","612":"Actividades Empresariales y Profesionales","614":"Intereses","616":"Sin obligaciones fiscales","620":"Sociedades Cooperativas","621":"Incorporación Fiscal","622":"Actividades Agrícolas","623":"Grupos de Sociedades","626":"Simplificado de Confianza" };
const USO_MATCH = { G01:"Adquisición de mercancías", G02:"Devoluciones", G03:"Gastos en general", I01:"Construcciones", P01:"Por definir", S01:"Sin efectos fiscales", CP01:"Pagos" };

const log = (...a) => console.log(...a);

// ---- R2 (S3-compatible) ----
function r2() {
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}
async function putR2(key, body, contentType) {
  await r2().send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, Body: body, ContentType: contentType }));
  return key;
}
function extractUuid(xmlBuf) {
  const m = /UUID="([0-9A-Fa-f-]{36})"/.exec(xmlBuf.toString("utf8"));
  return m ? m[1].toUpperCase() : null;
}

// ---- Mongo ticket update ----
async function deliverToTicket(ticketId, { pdf, xml, total }) {
  const cfdi = {
    uuid: xml ? extractUuid(xml.buffer) : null,
    pdfKey: null, xmlKey: null,
    pdfName: pdf?.filename || null, xmlName: xml?.filename || null,
    total: total != null ? Number(total) : null,
    deliveredAt: new Date().toISOString(),
  };
  if (xml) cfdi.xmlKey = await putR2(`invoices/${ticketId}/cfdi.xml`, xml.buffer, "application/xml");
  if (pdf) cfdi.pdfKey = await putR2(`invoices/${ticketId}/cfdi.pdf`, pdf.buffer, "application/pdf");

  const c = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 12000 });
  await c.connect();
  await c.db().collection("tickets").updateOne(
    { _id: (await import("mongodb")).ObjectId.createFromHexString(ticketId) },
    { $set: { "invoice.cfdi": cfdi, "invoice.status": "done", "invoice.method": "recipe" } }
  );
  await c.close();
  log(`✓ ticket ${ticketId} → done · uuid=${cfdi.uuid} pdf=${!!cfdi.pdfKey} xml=${!!cfdi.xmlKey}`);
  return cfdi;
}

// ---- OXXO portal driver (mirror of libs/engine/portals/oxxo.js) ----
const E = (id) => "#form\\:" + String(id).replace(/:/g, "\\:");
function dateParts(v) {
  if (typeof v === "string") {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v); if (iso) return { day:+iso[3], month0:+iso[2]-1, year:+iso[1] };
    const dmy = /(\d{2})\/(\d{2})\/(\d{4})/.exec(v); if (dmy) return { day:+dmy[1], month0:+dmy[2]-1, year:+dmy[3] };
  }
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? null : { day:d.getUTCDate(), month0:d.getUTCMonth(), year:d.getUTCFullYear() };
}
async function driveOxxo(page, data) {
  const body = async () => (await page.locator("body").first().innerText().catch(()=>"")).replace(/\s+/g," ");
  const set = async (id,v) => { const l=page.locator(E(id)).first(); await l.click({timeout:4000}).catch(()=>{}); await l.fill(String(v),{timeout:5000}).catch(()=>{}); };
  const pick = async (b,m) => { await page.locator(E(b+"_label")).first().click({timeout:5000}).catch(()=>{}); await page.waitForTimeout(900);
    const lis=page.locator(E(b+"_panel")+" li"); const n=await lis.count();
    for(let i=0;i<n;i++){ const t=(await lis.nth(i).innerText().catch(()=>"")).trim(); if(t&&t.toLowerCase().includes(String(m).toLowerCase())){ await lis.nth(i).click({timeout:4000}).catch(()=>{}); await page.waitForTimeout(400); return t; } } return null; };

  if (!String(page.url()||"").includes("oxxo.com")) await page.goto(PORTAL,{waitUntil:"domcontentloaded",timeout:60000});
  await page.waitForTimeout(3500);
  try{const x=page.locator("#form\\:dlgInfoTicket > div:nth-of-type(1) > a").first(); if(await x.count())await x.click({timeout:4000});}catch{}
  await page.waitForTimeout(700);

  // date via calendar (with month nav)
  const p = dateParts(data.date);
  if (p) {
    await page.locator(E("fecha_input")).first().click({timeout:5000}).catch(()=>{}); await page.waitForTimeout(900);
    const target=`${MONTHS_ES[p.month0]} ${p.year}`;
    for(let h=0;h<24;h++){ const title=((await page.locator(".ui-datepicker-title").first().innerText().catch(()=>"")).trim()).toLowerCase(); if(!title||title===target)break;
      const mm=/([a-záéíóú]+)\s+(\d{4})/i.exec(title); const cm=mm?MONTHS_ES.indexOf(mm[1].toLowerCase()):p.month0; const cy=mm?+mm[2]:p.year;
      const dir=(cy*12+cm)>(p.year*12+p.month0)?".ui-datepicker-prev":".ui-datepicker-next"; await page.locator(dir).first().click({timeout:3000}).catch(()=>{}); await page.waitForTimeout(500); }
    const days=page.locator("#ui-datepicker-div a, .ui-datepicker-calendar a"); const dn=await days.count();
    for(let i=0;i<dn;i++){ if(((await days.nth(i).innerText().catch(()=>"")).trim())===String(p.day)){ await days.nth(i).click({timeout:4000}).catch(()=>{}); break; } }
    await page.waitForTimeout(400);
  }
  log("  fecha:", await page.locator(E("fecha_input")).first().inputValue().catch(()=>""));
  await set("folio", data.folio ?? ""); if(data.venta) await set("venta", data.venta); if(data.total!=null) await set("total", Number(data.total).toFixed(2));
  await page.locator(E("validarTicket")).first().click({timeout:6000}).catch(()=>{});
  const ALREADY=/ya\s.{0,30}facturad[oa]|previamente\sfacturad[oa]|ticket\sya\sfacturad/i;
  let validated=false, alreadyInvoiced=false;
  for(let s=0;s<7;s++){ await page.waitForTimeout(1800); const b=await body(); if(b.includes("ticket ingresado es válido")){validated=true;break;} if(ALREADY.test(b)){alreadyInvoiced=true;break;} }
  if(alreadyInvoiced){ log("  ✗ ticket YA FACTURADO"); return { validated:false, alreadyInvoiced:true, reachedDownload:false }; }
  log("  validado:", validated); if(!validated) return { validated:false, alreadyInvoiced:false, reachedDownload:false };

  await page.locator(E("continuar")).first().click({timeout:6000}).catch(()=>{}); await page.waitForTimeout(3500);
  await pick("selectOneMenuPais","xico");
  if(data.rfc)await set("rfc",data.rfc); if(data.businessName)await set("razon",data.businessName);
  if(data.street)await set("calle",data.street); if(data.exteriorNumber)await set("ext",data.exteriorNumber);
  if(data.colonia)await set("colonia",data.colonia); if(data.municipality)await set("dele",data.municipality); if(data.postalCode)await set("codigo",data.postalCode);
  if(data.state)await pick("estado",data.state);
  const reg=REGIMEN_MATCH[data.taxRegime]||""; if(reg)await pick("selectOneMenuRegFis",reg);
  await pick("selectOneMenuCFDI", USO_MATCH[data.cfdiUsage]||"Gastos en general");

  log("  >>> GENERAR <<<");
  await page.locator(E("generarFactura")).first().click({timeout:8000}).catch(()=>{}); await page.waitForTimeout(3000);
  for(const t of ["Aceptar","Sí","Si","Confirmar"]){ const b=page.locator(`.ui-dialog button:has-text("${t}"), .ui-confirmdialog button:has-text("${t}")`).first(); try{if(await b.count()){await b.click({timeout:3000});break;}}catch{} }
  let reached=false; for(let s=0;s<14;s++){ await page.waitForTimeout(2500); reached=await page.evaluate(()=>!![...document.querySelectorAll("button,input[type=submit],a")].find(e=>/descargar pdf/i.test(e.innerText||e.value||""))).catch(()=>false); if(reached)break; }
  return { validated:true, reachedDownload:reached };
}

// capture (mirror of libs/engine/delivery.js)
async function capture(page, label) {
  return page.evaluate(async (lab) => {
    const btn=[...document.querySelectorAll("button,input[type=submit]")].find(e=>new RegExp(lab,"i").test(e.innerText||e.value||""));
    if(!btn) return {err:"not found"};
    const form=btn.closest("form")||document.getElementById("form");
    const params=new URLSearchParams();
    for(const el of form.elements){ if(!el.name||el.disabled)continue; if((el.type==="checkbox"||el.type==="radio")&&!el.checked)continue; if(el.type==="submit"||el.type==="button")continue; params.append(el.name,el.value); }
    params.set(btn.name||btn.id, btn.value||btn.name||btn.id);
    const r=await fetch(form.action,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},body:params.toString(),credentials:"include"});
    const ab=await r.arrayBuffer(); const u=new Uint8Array(ab); let s=""; for(let i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);
    const cd=r.headers.get("content-disposition")||""; const fm=/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(cd);
    return { b64:btoa(s), len:u.length, filename: fm?decodeURIComponent(fm[1]):null };
  }, label);
}

async function loadTicketData(ticketId) {
  const c = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 12000 });
  await c.connect(); const db=c.db();
  const { ObjectId } = await import("mongodb");
  const t = await db.collection("tickets").findOne({ _id: ObjectId.createFromHexString(ticketId) });
  if(!t) throw new Error("ticket not found: "+ticketId);
  let co=null; if(t.companyId)co=await db.collection("companies").findOne({_id:t.companyId});
  if(!co)co=await db.collection("companies").findOne({userId:t.userId});
  await c.close();
  const e=t.extracted||{}; const a=co?.fiscalAddress||{};
  // venta fallback: regex over ocrText if not structured yet
  let venta=e.venta; if(!venta&&t.ocrText){ const m=/\bID\s*[=:]\s*([A-Z0-9]{6,})/i.exec(t.ocrText); if(m)venta=m[1].toUpperCase(); }
  return {
    folio:e.folio, total:e.total, date:e.date, venta,
    rfc:co?.rfc, businessName:co?.businessName,
    street:[a.streetType,a.streetName].filter(Boolean).join(" ")||null, exteriorNumber:a.exteriorNumber, colonia:a.neighborhood,
    municipality:a.municipality, postalCode:a.postalCode, state:a.state,
    taxRegime:Array.isArray(co?.taxRegime)?co.taxRegime[0]:co?.taxRegime, cfdiUsage:"G03",
  };
}

async function main() {
  const args = process.argv.slice(2);

  // --files mode: upload pre-downloaded files, no portal.
  if (args[0] === "--files") {
    const [, pdfPath, xmlPath, ticketId] = args;
    if(!ticketId){ console.error("usage: --files <pdf> <xml> <ticketId>"); process.exit(1); }
    const pdf = pdfPath && fs.existsSync(pdfPath) ? { buffer:fs.readFileSync(pdfPath), filename:"cfdi.pdf" } : null;
    const xml = xmlPath && fs.existsSync(xmlPath) ? { buffer:fs.readFileSync(xmlPath), filename:"cfdi.xml" } : null;
    await deliverToTicket(ticketId, { pdf, xml, total: null });
    return;
  }

  const ticketId = args[0];
  if(!ticketId){ console.error("usage: scripts/oxxo-deliver.mjs <ticketId>   (or --files <pdf> <xml> <ticketId>)"); process.exit(1); }
  const data = await loadTicketData(ticketId);
  log("ticket data:", JSON.stringify({ folio:data.folio, venta:data.venta, total:data.total, date:data.date, rfc:data.rfc }, null, 0));

  const { Stagehand } = await import("@browserbasehq/stagehand");
  const sh = new Stagehand({ env:"BROWSERBASE", apiKey:process.env.BROWSERBASE_API_KEY, projectId:process.env.BROWSERBASE_PROJECT_ID, model:"anthropic/claude-sonnet-4-6", disablePino:true });
  await sh.init();
  try {
    const page = sh.context.pages()[0];
    const res = await driveOxxo(page, data);
    if(!res.reachedDownload){ console.error("✗ did not reach download screen (validated="+res.validated+")"); process.exit(2); }
    const xmlRes = await capture(page, "descargar xml");
    const pdfRes = await capture(page, "descargar pdf");
    const xml = xmlRes?.b64 ? { buffer:Buffer.from(xmlRes.b64,"base64"), filename:xmlRes.filename||"cfdi.xml" } : null;
    const pdf = pdfRes?.b64 ? { buffer:Buffer.from(pdfRes.b64,"base64"), filename:pdfRes.filename||"cfdi.pdf" } : null;
    log(`captured: pdf=${pdf?.buffer.length||0}b xml=${xml?.buffer.length||0}b`);
    await deliverToTicket(ticketId, { pdf, xml, total: data.total });
  } finally {
    await sh.close().catch(()=>{});
  }
}

main().catch((e)=>{ console.error("✗", e?.message||e); process.exit(1); });
