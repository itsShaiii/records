#!/usr/bin/env node
// نظام ادارة السجلات - النسخة النهائية
// تشغيل: node --experimental-sqlite server.js
// ثم افتح: http://localhost:3000

'use strict';
const http = require('node:http');
const fs   = require('node:fs');
const path = require('node:path');
const url  = require('node:url');
const { Client } = require('pg');

const PORT          = process.env.PORT || 3000;
const UPLOADS_DIR   = path.join(__dirname, 'uploads');
const SETTINGS_PASS = process.env.SETTINGS_PASS || '1234';
const DATABASE_URL  = process.env.DATABASE_URL || 'postgresql://postgres.vpkiddvdzpaapcyzwerv:REcords123%40%5C@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres';

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// PostgreSQL client
const db = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function initDB() {
  await db.connect();
  // Add new columns if they don't exist (safe migration)
  await db.query(`ALTER TABLE records ADD COLUMN IF NOT EXISTS full_name TEXT DEFAULT ''`).catch(()=>{});
  await db.query(`ALTER TABLE records ADD COLUMN IF NOT EXISTS modified_by TEXT DEFAULT ''`).catch(()=>{});
  await db.query(`ALTER TABLE records ADD COLUMN IF NOT EXISTS modified_at TEXT DEFAULT ''`).catch(()=>{});

  await db.query(`
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY, civil_id TEXT NOT NULL, full_name TEXT DEFAULT '',
      type TEXT NOT NULL, status TEXT DEFAULT 'جديد', priority TEXT DEFAULT 'متوسط',
      employee TEXT DEFAULT '', notes TEXT DEFAULT '',
      modified_by TEXT DEFAULT '', modified_at TEXT DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attachments (
      id SERIAL PRIMARY KEY,
      record_id TEXT NOT NULL, filename TEXT NOT NULL,
      original TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS employees (id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS types (id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL);
  `);

  const empCount = (await db.query('SELECT COUNT(*) as c FROM employees')).rows[0].c;
  if (empCount === '0') {
    const names = ['سيف النبهاني','محمد الكلباني','ناصر العلوي','عيسى العلوي','هيثم العزري','عبدالعزيز','احمد','رؤى العزري','عزه المحروقي'];
    for (const n of names) await db.query('INSERT INTO employees(name) VALUES($1) ON CONFLICT DO NOTHING', [n]);
  }
  const typeCount = (await db.query('SELECT COUNT(*) as c FROM types')).rows[0].c;
  if (typeCount === '0') {
    const types = ['تسجيل مواطن','تحديث بيانات','اصدار وثيقة','تصحيح خطأ','طلب استعلام','معاملة ادارية'];
    for (const t of types) await db.query('INSERT INTO types(name) VALUES($1) ON CONFLICT DO NOTHING', [t]);
  }
  console.log('Database connected and ready');
}

async function uid() {
  const r = await db.query('SELECT COUNT(*) as c FROM records');
  return String(Number(r.rows[0].c) + 1);
}
function now()  { return new Date().toISOString(); }
function jres(res, data, code) {
  res.writeHead(code||200, { 'Content-Type':'application/json;charset=utf-8', 'Access-Control-Allow-Origin':'*' });
  res.end(JSON.stringify(data));
}
function getBody(req) {
  return new Promise((ok,fail) => {
    let d = '';
    req.on('data', c => d += c);
    req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch(e) { fail(e); } });
    req.on('error', fail);
  });
}
function getMultipart(req) {
  return new Promise((ok,fail) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('error', fail);
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      const ct  = req.headers['content-type'] || '';
      const bm  = ct.match(/boundary=(?:"([^"]+)"|([^;\s]+))/);
      if (!bm) return ok({ files:[] });
      const bound = '--' + (bm[1] || bm[2]);
      const files = [];
      let s = buf.indexOf(bound);
      while (s !== -1) {
        const e = buf.indexOf(bound, s + bound.length);
        if (e === -1) break;
        const part = buf.slice(s + bound.length + 2, e - 2);
        const he   = part.indexOf('\r\n\r\n');
        if (he !== -1) {
          const hdrs = part.slice(0, he).toString();
          const nm   = hdrs.match(/name="([^"]+)"/)?.at(1);
          const fn   = hdrs.match(/filename="([^"]+)"/)?.at(1);
          if (nm && fn) files.push({ name:nm, filename:fn, data:part.slice(he+4) });
        }
        s = e;
      }
      ok({ files });
    });
  });
}

// ── HTML كامل ─────────────────────────────────────────────────────────────────
function buildHTML() {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>نظام تتبع الطلبات</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --p1:#2F5D50;--p2:#6E8F7B;--p3:#f0f5f3;--p4:#b8d0c8;
  --acc:#C47A3A;--acc2:#fdf3e8;--acc3:#f0c99a;
  --r1:#be123c;--r2:#fff1f2;
  --g1:#f8fafc;--g2:#f1f5f9;--g3:#e2e8f0;--g4:#94a3b8;--g5:#64748b;--g6:#374151;--g7:#1e293b;
  --sh:0 1px 3px rgba(0,0,0,.07);--sha:0 4px 16px rgba(0,0,0,.1);
  --rad:12px;--rads:8px;--radl:16px;
}
body{font-family:"Segoe UI",Tahoma,Arial,sans-serif;background:var(--g2);color:var(--g7);min-height:100vh;font-size:14px}
::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:var(--g3);border-radius:3px}
input,select,textarea,button{font-family:inherit}
.hdr{background:linear-gradient(135deg,#1a3d32,var(--p1) 55%,#3a7060);padding:0 20px;box-shadow:0 4px 20px rgba(47,93,80,.35);position:sticky;top:0;z-index:100}
.hdr-in{max-width:1400px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;height:60px;gap:10px}
.logo{width:34px;height:34px;background:rgba(255,255,255,.15);border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:17px}
.hdr-t{color:#fff;font-weight:700;font-size:15px}
.hdr-s{color:rgba(255,255,255,.6);font-size:11px;display:flex;align-items:center;gap:5px}
.dot{width:6px;height:6px;border-radius:50%;background:var(--acc);display:inline-block;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
.nav{display:flex;gap:5px}
.nb{background:transparent;border:1px solid transparent;color:rgba(255,255,255,.65);padding:6px 13px;border-radius:var(--rads);cursor:pointer;font-size:13px;font-weight:600;transition:all .15s}
.nb:hover{background:rgba(255,255,255,.1);color:#fff}
.nb.on{background:rgba(255,255,255,.18);color:#fff;border-color:rgba(255,255,255,.28)}
.tbar{height:3px;background:var(--p3);position:fixed;top:60px;left:0;right:0;z-index:99}
.tfill{height:100%;background:var(--acc);transition:width linear;width:100%}
.main{max-width:1400px;margin:0 auto;padding:22px 14px}
.card{background:#fff;border-radius:var(--radl);box-shadow:var(--sh)}
.cb{padding:22px}
.btn{display:inline-flex;align-items:center;gap:5px;padding:8px 16px;border:none;border-radius:var(--rads);font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;white-space:nowrap;font-family:inherit}
.btn:hover{filter:brightness(.9);transform:translateY(-1px)}.btn:active{transform:none}
.bp{background:var(--p1);color:#fff}.bp:hover{background:#264d43;filter:none}
.bs{background:var(--g3);color:var(--g6)}.bd{background:var(--r2);color:var(--r1)}
.bg{background:transparent;color:var(--g5);padding:6px 10px}.bsm{padding:5px 11px;font-size:12px}
.bi{background:transparent;border:none;cursor:pointer;padding:4px;border-radius:5px;color:var(--g4);font-size:14px;transition:all .15s}
.bi:hover{background:var(--g2);color:var(--g7)}
.inp{width:100%;padding:8px 12px;border:1.5px solid var(--g3);border-radius:9px;font-size:13px;color:var(--g7);background:var(--g1);outline:none;transition:all .15s}
.inp:focus{border-color:var(--p2);box-shadow:0 0 0 3px rgba(110,143,123,.15);background:#fff}
.inp::placeholder{color:var(--g4)}
.lbl{font-size:12px;font-weight:600;color:var(--g6);margin-bottom:4px;display:block}
.fgrid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:580px){.fgrid{grid-template-columns:1fr}}
.twrap{overflow-x:auto;border-radius:var(--radl)}
table{width:100%;border-collapse:collapse;min-width:750px}
thead tr{background:var(--g1);border-bottom:2px solid var(--g3)}
th{padding:11px 13px;text-align:right;font-size:12px;font-weight:700;color:var(--g5);white-space:nowrap}
tbody tr{border-bottom:1px solid var(--g2);cursor:pointer;transition:background .1s}
tbody tr:hover{background:var(--p3)}
tbody tr.od{background:#fffbeb}
td{padding:10px 13px;font-size:13px;color:var(--g6);vertical-align:middle}
.ssel{padding:3px 9px;border-radius:18px;font-size:12px;font-weight:600;cursor:pointer;outline:none;border:1px solid;font-family:inherit}
.bge{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:18px;font-size:12px;font-weight:600;white-space:nowrap}
.bdot{width:6px;height:6px;border-radius:50%}
.sgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:18px}
.sc{background:#fff;border-radius:var(--radl);box-shadow:var(--sh);padding:16px;transition:transform .15s}
.sc:hover{transform:translateY(-2px);box-shadow:var(--sha)}
.si{font-size:20px;margin-bottom:6px}.sv{font-size:26px;font-weight:800;line-height:1}.sl{font-size:11px;color:var(--g5);margin-top:3px}
#toast{position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:9999;padding:10px 20px;border-radius:9px;color:#fff;font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.18);display:none;white-space:nowrap}
.mbg{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:500;display:flex;align-items:center;justify-content:center;padding:14px}
.mbox{background:#fff;border-radius:var(--radl);box-shadow:0 20px 60px rgba(0,0,0,.2);max-width:540px;width:100%;max-height:90vh;overflow-y:auto;animation:sup .2s ease}
@keyframes sup{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
.page{animation:fin .22s ease}
@keyframes fin{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
.tb{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:10px;flex-wrap:wrap}
.tb h2{font-size:19px;font-weight:700;color:var(--g7)}.tb p{color:var(--g5);font-size:12px}
.fb{background:#fff;border-radius:var(--radl);box-shadow:var(--sh);padding:12px 16px;margin-bottom:12px}
.fbar{display:grid;grid-template-columns:1.5fr 1fr 1fr 1fr;gap:10px}
@media(max-width:768px){.fbar{grid-template-columns:1fr 1fr}}
@media(max-width:480px){.fbar{grid-template-columns:1fr}}
.dgrid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:18px}
@media(max-width:720px){.dgrid{grid-template-columns:1fr 1fr}}
@media(max-width:460px){.dgrid{grid-template-columns:1fr}}
.df{background:var(--g1);border-radius:9px;padding:12px}
.dfl{font-size:10px;color:var(--g4);margin-bottom:3px}.dfv{font-size:13px;font-weight:600;color:var(--g7)}
.oda{background:#fffbeb;border:1px solid var(--acc3);border-radius:var(--rad);padding:11px 14px;margin-bottom:12px;color:var(--acc);font-weight:600;font-size:13px}
.pbg{height:7px;background:var(--g2);border-radius:3px;overflow:hidden;margin-top:5px}
.pb{height:100%;border-radius:3px;transition:width .5s ease}
.stitle{font-size:14px;font-weight:700;color:var(--g7);margin-bottom:10px;padding-bottom:7px;border-bottom:2px solid var(--g2)}
.tlist{display:flex;flex-wrap:wrap;gap:7px}
.tag{display:inline-flex;align-items:center;gap:5px;background:var(--g2);border-radius:18px;padding:4px 11px;font-size:12px;font-weight:500;color:var(--g6)}
.tdel{background:none;border:none;cursor:pointer;color:var(--g4);font-size:15px;line-height:1;padding:0 1px;transition:color .15s}
.tdel:hover{color:var(--r1)}.arow{display:flex;gap:7px;margin-top:9px}
.agrid{display:flex;flex-wrap:wrap;gap:9px;margin-top:9px}
.ait{position:relative;width:88px;height:88px;border-radius:9px;overflow:hidden;border:2px solid var(--g3);cursor:pointer;background:var(--g1);display:flex;align-items:center;justify-content:center;transition:border-color .15s}
.ait:hover{border-color:var(--p2)}.ait img{width:100%;height:100%;object-fit:cover}
.adel{position:absolute;top:2px;left:2px;background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:50%;width:19px;height:19px;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .15s}
.ait:hover .adel{opacity:1}
.aup{display:flex;border:2px dashed var(--g3);cursor:pointer;flex-direction:column;gap:3px;color:var(--g4);font-size:11px;text-align:center;transition:all .15s}
.aup:hover{border-color:var(--p2);color:var(--p1);background:var(--p3)}.aup input{display:none}
.apdf{font-size:26px}
#lb{position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9000;display:none;align-items:center;justify-content:center;cursor:pointer}
#lb img{max-width:92vw;max-height:92vh;border-radius:7px}
.pg{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:260px;gap:14px;text-align:center}
@media(max-width:460px){.hdr-in{height:52px}.main{padding:12px 9px}}

.login-bg{position:fixed;inset:0;background:linear-gradient(135deg,#1a3d32,#2F5D50 55%,#3a7060);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px}
.login-box{background:#fff;border-radius:20px;padding:40px 36px;width:100%;max-width:400px;box-shadow:0 20px 60px rgba(0,0,0,.25);text-align:center}
.login-logo{width:70px;height:70px;background:linear-gradient(135deg,#2F5D50,#6E8F7B);border-radius:18px;display:flex;align-items:center;justify-content:center;font-size:32px;margin:0 auto 20px}
.login-title{font-size:20px;font-weight:800;color:#1e293b;margin-bottom:6px}
.login-sub{font-size:13px;color:#64748b;margin-bottom:28px;line-height:1.6}
.login-err{background:#fff1f2;color:#be123c;border-radius:8px;padding:10px;font-size:13px;font-weight:600;margin-bottom:14px;display:none}
</style>
</head>
<body>
<div id="toast"></div>
<div id="lb" onclick="this.style.display='none'"><img id="lbimg" src=""></div>
<div class="tbar"><div class="tfill" id="tfill"></div></div>
<div id="mbg" class="mbg" style="display:none" onclick="if(event.target===this)cm()">
  <div class="mbox" id="mbox"></div>
</div>
<header class="hdr">
  <div class="hdr-in">
    <div style="display:flex;align-items:center;gap:12px">
      <img src="data:image/jpeg;base64,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V6TkZMVkLvKyf2xBTJzW8k/bwHmyev3GSXX7kkkd4kMdfDP7bBLv1nrIcmP22SDZkz6T1kTgftqSR3jIzrIzWL+3iJ95P7joOP3Lw4JT4P/ZICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIA==" alt="صندوق الحماية الاجتماعية" style="height:44px;object-fit:contain;border-radius:10px">
      <div>
        <div class="hdr-t">نظام تتبع الطلبات</div>
        <div class="hdr-s"><span class="dot"></span><span id="hsub">جاري التحميل...</span></div>
      </div>
    </div>
    <nav class="nav">
      <button class="nb on" data-pg="r" onclick="sp('r')">السجلات</button>
      <button class="nb" data-pg="d" onclick="sp('d')">الاحصائيات</button>
      <button class="nb" data-pg="s" onclick="sp('s')">الاعدادات</button>
    </nav>
  </div>
</header>
<main class="main">
  <div id="pr" class="page"></div>
  <div id="pd" class="page" style="display:none"></div>
  <div id="ps" class="page" style="display:none"></div>
</main>
<script>
var ST = { recs:[], emps:[], types:[], stats:null, pg:"r", did:null, fm:null, ed:null, su:false };
var SO = ["جديد","قيد التنفيذ","مكتمل","مرفوض"];
var PO = ["عالي","متوسط","منخفض"];
var SS = {
  "جديد":        {bg:"#eff6ff",tx:"#1d4ed8",bd:"#bfdbfe"},
  "قيد التنفيذ": {bg:"#fffbeb",tx:"#92580a",bd:"#f0c99a"},
  "مكتمل":       {bg:"#f0f5f3",tx:"#2F5D50",bd:"#b8d0c8"},
  "مرفوض":       {bg:"#fff1f2",tx:"#be123c",bd:"#fecdd3"}
};
var PS = {
  "عالي":  {bg:"#fff1f2",tx:"#be123c",dot:"#f43f5e"},
  "متوسط": {bg:"#fffbeb",tx:"#92580a",dot:"#f59e0b"},
  "منخفض": {bg:"#f0f5f3",tx:"#2F5D50",dot:"#22c55e"}
};
var FLT = {status:"",priority:"",employee:"",search:"",sort:"desc"};

var RFR = null;
var RFMS = 60000;
function startRF() {
  clearTimeout(RFR);
  var f = document.getElementById("tfill");
  if (f) { f.style.transition = "none"; f.style.width = "100%"; }
  setTimeout(function() {
    if (f) { f.style.transition = "width " + (RFMS/1000) + "s linear"; f.style.width = "0%"; }
  }, 80);
  RFR = setTimeout(function() {
    if (ST.pg === "r" && !ST.fm) {
      loadRecs().then(function() { if (!ST.fm && !ST.did) renderTbl(); });
    }
    startRF();
  }, RFMS);
}

async function api(m, u, b) {
  var o = {method:m, headers:{"Content-Type":"application/json"}};
  if (b) o.body = JSON.stringify(b);
  return (await fetch("/api" + u, o)).json();
}

async function init() {
  await Promise.all([loadRecs(), loadEmps(), loadTypes()]);
  renderPage();
  startRF();
}

async function loadRecs() {
  var q = new URLSearchParams();
  if (FLT.status)   q.set("status",   FLT.status);
  if (FLT.priority) q.set("priority", FLT.priority);
  if (FLT.employee) q.set("employee", FLT.employee);
  if (FLT.search)   q.set("search",   FLT.search);
  q.set("sort", FLT.sort);
  var r = await (await fetch("/api/records?" + q)).json();
  if (r.success) ST.recs = r.data;
  var el = document.getElementById("hsub");
  if (el) el.textContent = (ST.recs.length || 0) + " سجل";
}
async function loadEmps()  { var r = await api("GET","/employees");  if (r.success) ST.emps  = r.data; }
async function loadTypes() { var r = await api("GET","/types");      if (r.success) ST.types = r.data; }
async function loadStats() { var r = await api("GET","/stats");      if (r.success) ST.stats = r.data; }

function sp(pg) {
  ST.pg = pg; ST.did = null; ST.fm = null;
  document.querySelectorAll(".nb").forEach(function(b) { b.classList.toggle("on", b.dataset.pg === pg); });
  ["r","d","s"].forEach(function(p) { document.getElementById("p"+p).style.display = p === pg ? "" : "none"; });
  renderPage();
}

async function renderPage() {
  if (ST.pg === "r") {
    if (ST.fm) renderForm();
    else if (ST.did) await renderDetail();
    else { await loadRecs(); renderTbl(); }
  } else if (ST.pg === "d") { await loadStats(); renderDash(); }
  else renderSettings();
}

function numOnly(el) {
  var v = el.value, r = "";
  for (var i = 0; i < v.length; i++) { if (v[i] >= "0" && v[i] <= "9") r += v[i]; }
  el.value = r;
}
function esc(s) {
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function fdt(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ar",{year:"numeric",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit"});
}
function isOD(r) { return r.status !== "مكتمل" && r.status !== "مرفوض" && (Date.now() - new Date(r.created_at)) > 3*86400000; }
function toast(msg, bg) {
  var t = document.getElementById("toast");
  t.textContent = msg; t.style.background = bg || "var(--p1)"; t.style.display = "block";
  clearTimeout(t._t); t._t = setTimeout(function() { t.style.display = "none"; }, 3000);
}

function renderTbl() {
  var el  = document.getElementById("pr");
  var hf  = FLT.status || FLT.priority || FLT.employee || FLT.search;
  var od  = ST.recs.filter(isOD);
  var h   = "";
  h += "<div class='tb'><div><h2>جميع السجلات</h2><p>" + ST.recs.length + " سجل" + (hf ? " (بعد الفلتر)" : "") + "</p></div>";
  h += "<button class='btn bp' onclick='openAdd()'>+ اضافة سجل</button></div>";
  if (od.length) h += "<div class='oda'>تحذير: يوجد " + od.length + " سجل متأخر (اكثر من 3 ايام)</div>";
  h += "<div class='fb'><div class='fbar'>";
  h += "<input class='inp' id='fsearch' placeholder='بحث بالرقم المدني او رقم الطلب...' value='" + esc(FLT.search) + "' oninput='FLT.search=this.value;dbs()'>";
  h += "<select class='inp' onchange='FLT.status=this.value;apf()'><option value=''>جميع الحالات</option>";
  SO.forEach(function(s) { h += "<option" + (FLT.status===s?" selected":"") + ">" + s + "</option>"; });
  h += "</select><select class='inp' onchange='FLT.priority=this.value;apf()'><option value=''>جميع الاولويات</option>";
  PO.forEach(function(p) { h += "<option" + (FLT.priority===p?" selected":"") + ">" + p + "</option>"; });
  h += "</select><select class='inp' onchange='FLT.employee=this.value;apf()'><option value=''>جميع الموظفين</option>";
  ST.emps.forEach(function(e) { h += "<option" + (FLT.employee===e?" selected":"") + ">" + esc(e) + "</option>"; });
  h += "</select></div>";
  if (hf) h += "<button class='btn bg bsm' style='margin-top:7px' onclick='clf()'>مسح الفلاتر</button>";
  h += "</div>";
  h += "<div class='card twrap'><table><thead><tr>";
  h += "<th>رقم الطلب</th><th>الرقم المدني</th><th>الاسم</th><th>نوع المعاملة</th><th>الحالة</th><th>الاولوية</th><th>الموظف</th>";
  h += "<th><button style='background:none;border:none;cursor:pointer;font-weight:700;font-size:12px;color:var(--g5);font-family:inherit' onclick='tgsort()'>تاريخ الانشاء " + (FLT.sort==="desc"?"(الاحدث)":"(الاقدم)") + "</button></th>";
  h += "<th>الاجراءات</th></tr></thead><tbody>";
  if (ST.recs.length === 0) {
    h += "<tr><td colspan='8' style='text-align:center;padding:50px;color:var(--g4)'><div style='font-size:36px;margin-bottom:8px'>&#128197;</div>لا توجد سجلات مطابقة</td></tr>";
  } else {
    ST.recs.forEach(function(r) { h += rrow(r); });
  }
  h += "</tbody></table></div>";
  el.innerHTML = h;
}

function rrow(r) {
  var sc = SS[r.status] || {};
  var pc = PS[r.priority] || {};
  var od = isOD(r);
  var h  = "";
  h += "<tr class='" + (od?"od":"") + "' data-id='" + r.id + "' onclick='openDetail(this.dataset.id)'>";
  h += "<td><strong style='color:var(--p1)'>" + r.id + "</strong>";
  if (od) h += "<span class='bge' style='background:#fffbeb;color:var(--acc);font-size:10px;margin-right:5px'>متأخر</span>";
  h += "</td>";
  h += "<td style='font-family:monospace'>" + esc(r.civil_id) + "</td>";
  h += "<td>" + esc(r.full_name||"—") + "</td>";
  h += "<td>" + esc(r.type) + "</td>";
  h += "<td onclick='event.stopPropagation()'>";
  h += "<select class='ssel' style='background:" + sc.bg + ";color:" + sc.tx + ";border-color:" + sc.bd + "' data-id='" + r.id + "' onchange='qst(this.dataset.id,this.value)'>";
  SO.forEach(function(s) { h += "<option" + (r.status===s?" selected":"") + ">" + s + "</option>"; });
  h += "</select></td>";
  h += "<td><span class='bge' style='background:" + pc.bg + ";color:" + pc.tx + "'><span class='bdot' style='background:" + pc.dot + "'></span>" + r.priority + "</span></td>";
  h += "<td>" + (r.employee || "<span style='color:var(--g4)'>—</span>") + "</td>";
  h += "<td style='color:var(--g5)'>" + fdt(r.created_at) + "</td>";
  h += "<td onclick='event.stopPropagation()'><div style='display:flex;gap:3px'>";
  h += "<button class='bi' data-id='" + r.id + "' onclick='openEdit(this.dataset.id)'>&#9998;</button>";
  h += "<button class='bi' data-id='" + r.id + "' onclick='cdel(this.dataset.id)'>&#128465;</button>";
  h += "</div></td></tr>";
  return h;
}

async function renderDetail() {
  var res  = await fetch("/api/records/" + ST.did);
  var data = await res.json();
  if (!data.success) { ST.did = null; renderTbl(); return; }
  var r    = data.data;
  var atts = r.attachments || [];
  var sc   = SS[r.status] || {};
  var pc   = PS[r.priority] || {};
  var od   = isOD(r);
  var el   = document.getElementById("pr");
  var h    = "";
  h += "<div class='tb'><div style='display:flex;align-items:center;gap:9px'>";
  h += "<button class='btn bs bsm' onclick='ST.did=null;renderPage()'>رجوع</button>";
  h += "<div><h2>" + r.id + "</h2><p>تفاصيل السجل</p></div></div>";
  h += "<div style='display:flex;gap:7px'>";
  h += "<button class='btn bs bsm' data-id='" + r.id + "' onclick='openEdit(this.dataset.id)'>تعديل</button>";
  h += "<button class='btn bd bsm' data-id='" + r.id + "' onclick='cdel(this.dataset.id)'>حذف</button>";
  h += "</div></div>";
  if (od) h += "<div class='oda'>تحذير: هذا السجل متأخر - تجاوز 3 ايام دون اكمال</div>";
  h += "<div class='card cb'><div class='dgrid'>";
  h += "<div class='df'><div class='dfl'>رقم الطلب</div><div class='dfv'>" + r.id + "</div></div>";
  h += "<div class='df'><div class='dfl'>الرقم المدني</div><div class='dfv' style='font-family:monospace'>" + esc(r.civil_id) + "</div></div>";
  h += "<div class='df'><div class='dfl'>نوع المعاملة</div><div class='dfv'>" + esc(r.type) + "</div></div>";
  h += "<div class='df'><div class='dfl'>الاسم</div><div class='dfv'>" + esc(r.full_name||"—") + "</div></div>";
  h += "<div class='df'><div class='dfl'>الموظف المسؤول</div><div class='dfv'>" + esc(r.employee||"غير محدد") + "</div></div>";
  h += "<div class='df'><div class='dfl'>منفذ آخر تعديل</div><div class='dfv'>" + (r.modified_by ? esc(r.modified_by) + " — " + fdt(r.modified_at) : "—") + "</div></div>";
  h += "<div class='df'><div class='dfl'>تاريخ الانشاء</div><div class='dfv'>" + fdt(r.created_at) + "</div></div>";
  h += "<div class='df'><div class='dfl'>آخر تحديث</div><div class='dfv'>" + fdt(r.updated_at) + "</div></div>";
  h += "</div><div style='display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px'>";
  h += "<div><div class='lbl'>تغيير الحالة</div>";
  h += "<select class='inp' style='width:auto;padding:7px 14px;border-radius:9px;border-color:" + sc.bd + ";background:" + sc.bg + ";color:" + sc.tx + ";font-weight:700' data-id='" + r.id + "' onchange='qstd(this.dataset.id,this.value)'>";
  SO.forEach(function(s) { h += "<option" + (r.status===s?" selected":"") + ">" + s + "</option>"; });
  h += "</select></div>";
  h += "<div><div class='lbl'>الاولوية</div><span class='bge' style='background:" + pc.bg + ";color:" + pc.tx + ";padding:7px 13px;font-size:13px'><span class='bdot' style='background:" + pc.dot + ";width:8px;height:8px'></span>" + r.priority + "</span></div></div>";
  if (r.notes) {
    h += "<div style='background:var(--g1);border-radius:9px;padding:14px;margin-bottom:18px'><div class='lbl'>الملاحظات</div><div style='color:var(--g6);line-height:1.8;margin-top:3px'>" + esc(r.notes) + "</div></div>";
  }
  h += "<div><div class='lbl' style='margin-bottom:7px'>المرفقات والصور (" + atts.length + ")</div><div class='agrid' id='attgrid'>";
  atts.forEach(function(a) {
    var isI = /\.(jpg|jpeg|png|gif|webp)$/i.test(a.filename);
    h += "<div class='ait' data-src='/uploads/" + a.filename + "' " + (isI?"onclick='olb(this.dataset.src)' ":"") + "title='" + esc(a.original) + "'>";
    h += isI ? "<img src='/uploads/" + a.filename + "' alt='" + esc(a.original) + "'>" : "<div class='apdf'>PDF</div>";
    h += "<button class='adel' data-aid='" + a.id + "' onclick='event.stopPropagation();datt(this.dataset.aid)'>x</button></div>";
  });
  h += "<label class='ait aup'><input type='file' accept='image/*,.pdf' data-rid='" + r.id + "' onchange='upatt(this.dataset.rid,this)'/><div style='font-size:22px'>+</div><div>رفع صورة</div></label>";
  h += "</div></div></div>";
  el.innerHTML = h;
}

function renderForm() {
  var ie = ST.fm === "edit";
  var d  = ST.ed || {};
  var el = document.getElementById("pr");
  var h  = "";
  h += "<div class='tb'><div style='display:flex;align-items:center;gap:9px'>";
  h += "<button class='btn bs bsm' onclick='cfm()'>رجوع</button>";
  h += "<div><h2>" + (ie?"تعديل السجل":"اضافة سجل جديد") + "</h2><p>" + (ie?"تعديل "+d.id:"ادخل بيانات السجل الجديد") + "</p></div></div></div>";
  h += "<div class='card cb'>";
  h += "<div id='ferr' style='display:none;background:var(--r2);color:var(--r1);padding:9px 13px;border-radius:7px;margin-bottom:14px;font-size:13px;font-weight:600'></div>";
  h += "<div class='fgrid' style='margin-bottom:16px'>";
  h += "<div><label class='lbl'>الرقم المدني *</label><input class='inp' id='fciv' value='" + esc(d.civil_id||"") + "' placeholder='ادخل الرقم المدني' inputmode='numeric' onkeypress='return event.charCode>=48&&event.charCode<=57' oninput='numOnly(this)' ></div>";
  h += "<div><label class='lbl'>الاسم</label><input class='inp' id='fname' value='" + esc(d.full_name||"") + "' placeholder='اسم المستفيد'></div>";
  h += "<div><label class='lbl'>نوع المعاملة *</label><input class='inp' id='ftyp' value='" + esc(d.type||"") + "' list='tlist' placeholder='اختر او اكتب نوع المعاملة'><datalist id='tlist'>";
  ST.types.forEach(function(t) { h += "<option value='" + esc(t) + "'>"; });
  h += "</datalist></div>";
  h += "<div><label class='lbl'>الموظف المسؤول</label><select class='inp' id='femp'><option value=''>— اختر موظف —</option>";
  ST.emps.forEach(function(e) { h += "<option" + (d.employee===e?" selected":"") + ">" + esc(e) + "</option>"; });
  h += "</select></div>";
  h += "<div><label class='lbl'>منفذ التعديل (اختياري)</label><select class='inp' id='fmod'><option value=''>— اختر عند التعديل —</option>";
  ST.emps.forEach(function(e) { h += "<option" + ((d.modified_by||"")===e?" selected":"") + ">" + esc(e) + "</option>"; });
  h += "</select></div>";
  h += "<div><label class='lbl'>الحالة</label><select class='inp' id='fst'>";
  SO.forEach(function(s) { h += "<option" + ((d.status||"جديد")===s?" selected":"") + ">" + s + "</option>"; });
  h += "</select></div>";
  h += "<div><label class='lbl'>الاولوية</label><select class='inp' id='fpr'>";
  PO.forEach(function(p) { h += "<option" + ((d.priority||"متوسط")===p?" selected":"") + ">" + p + "</option>"; });
  h += "</select></div></div>";
  h += "<div style='margin-bottom:20px'><label class='lbl'>ملاحظات</label><textarea class='inp' id='fnt' rows='4' style='resize:vertical'>" + esc(d.notes||"") + "</textarea></div>";
  if (ie && d.id) {
    h += "<div style='margin-bottom:20px'><div class='lbl' style='margin-bottom:7px'>المرفقات والصور</div><div class='agrid' id='fattgrid'><div style='color:var(--g4);font-size:12px'>جاري التحميل...</div></div></div>";
  } else {
    h += "<div style='margin-bottom:20px;padding:12px;background:var(--p3);border-radius:9px;border:1.5px dashed var(--p4)'><div class='lbl'>المرفقات والصور</div><div style='color:var(--g5);font-size:12px;margin-top:4px'>بعد اضافة السجل ستنتقل تلقائياً لصفحة تفاصيله لرفع الصور</div></div>";
  }
  h += "<div style='display:flex;gap:9px;justify-content:flex-end'>";
  h += "<button class='btn bs' onclick='cfm()'>الغاء</button>";
  h += "<button class='btn bp' onclick='sbm()'>" + (ie?"حفظ التعديلات":"اضافة السجل") + "</button></div></div>";
  el.innerHTML = h;
  if (ie && d.id) setTimeout(function() { lfatt(d.id); }, 0);
}

async function sbm() {
  var civ  = document.getElementById("fciv").value.trim();
  var fnm  = document.getElementById("fname") ? document.getElementById("fname").value.trim() : "";
  var typ  = document.getElementById("ftyp").value.trim();
  var emp  = document.getElementById("femp").value;
  var st   = document.getElementById("fst").value;
  var pr   = document.getElementById("fpr").value;
  var nt   = document.getElementById("fnt").value.trim();
  if (!civ) { sfe("الرقم المدني مطلوب"); return; }
  if (!/^[0-9]+$/.test(civ)) { sfe("الرقم المدني يجب ان يحتوي على ارقام فقط"); return; }
  if (!typ) { sfe("نوع المعاملة مطلوب"); return; }
  var mod = document.getElementById("fmod") ? document.getElementById("fmod").value : "";
  var b = {civil_id:civ, full_name:fnm, type:typ, status:st, priority:pr, employee:emp, notes:nt, modified_by:mod, modified_at: mod ? new Date().toISOString() : ""};
  var r = ST.fm === "edit" ? await api("PUT","/records/"+ST.ed.id,b) : await api("POST","/records",b);
  if (!r.success) { sfe(r.error || "حدث خطأ"); return; }
  toast(ST.fm==="edit" ? "تم تحديث السجل" : "تم اضافة السجل");
  // After save, go to detail view so user can upload attachments right away
  var savedId = r.data.id;
  ST.fm = null; ST.ed = null;
  ST.did = savedId;
  await renderDetail();
}
function sfe(m) { var e = document.getElementById("ferr"); e.textContent = m; e.style.display = ""; }

async function lfatt(rid) {
  var res  = await fetch("/api/records/" + rid);
  var data = await res.json();
  var grid = document.getElementById("fattgrid");
  if (!grid || !data.success) return;
  var atts = data.data.attachments || [];
  var h    = "";
  atts.forEach(function(a) {
    var isI = /\.(jpg|jpeg|png|gif|webp)$/i.test(a.filename);
    h += "<div class='ait' data-src='/uploads/" + a.filename + "' " + (isI?"onclick='olb(this.dataset.src)' ":"") + ">";
    h += isI ? "<img src='/uploads/" + a.filename + "'>" : "<div class='apdf'>PDF</div>";
    h += "<button class='adel' data-aid='" + a.id + "' data-rid='" + rid + "' onclick='event.stopPropagation();dfatti(this.dataset.aid,this.dataset.rid)'>x</button></div>";
  });
  h += "<label class='ait aup'><input type='file' accept='image/*,.pdf' data-rid='" + rid + "' onchange='upfatt(this.dataset.rid,this)'/><div style='font-size:22px'>+</div><div>رفع صورة</div></label>";
  grid.innerHTML = h;
}

async function upfatt(rid, inp) {
  var file = inp.files[0]; if (!file) return;
  if (file.size > 10*1024*1024) { toast("الحجم الاقصى 10MB","#be123c"); return; }
  toast("جاري الرفع...");
  var fd = new FormData(); fd.append("file", file);
  var r  = await fetch("/api/records/"+rid+"/attachments", {method:"POST",body:fd});
  var d  = await r.json();
  if (!d.success) { toast(d.error||"فشل الرفع","#be123c"); return; }
  toast("تم رفع الملف"); await lfatt(rid);
}
async function dfatti(aid, rid) {
  if (!confirm("حذف هذا المرفق؟")) return;
  await api("DELETE","/attachments/"+aid); await lfatt(rid);
}

async function upatt(rid, inp) {
  var file = inp.files[0]; if (!file) return;
  if (file.size > 10*1024*1024) { toast("الحجم الاقصى 10MB","#be123c"); return; }
  toast("جاري الرفع...");
  var fd = new FormData(); fd.append("file", file);
  var r  = await fetch("/api/records/"+rid+"/attachments", {method:"POST",body:fd});
  var d  = await r.json();
  if (!d.success) { toast(d.error||"فشل الرفع","#be123c"); return; }
  toast("تم رفع الملف"); await renderDetail();
}
async function datt(aid) {
  if (!confirm("حذف هذا المرفق؟")) return;
  await api("DELETE","/attachments/"+aid); await renderDetail();
}
function olb(src) { document.getElementById("lbimg").src = src; document.getElementById("lb").style.display = "flex"; }

function renderDash() {
  var s  = ST.stats; if (!s) return;
  var el = document.getElementById("pd");
  var pm = {};
  (s.by_prio||[]).forEach(function(p) { pm[p.priority] = p.n; });
  var sm = {"جديد":s.new_,"قيد التنفيذ":s.prog,"مكتمل":s.done,"مرفوض":s.rej};
  var h  = "<div class='tb' style='margin-bottom:16px'><div><h2>لوحة الاحصائيات</h2><p>نظرة عامة على جميع السجلات</p></div></div>";
  h += "<div class='sgrid'>";
  var cards = [
    {ic:"&#128203;",lb:"الاجمالي",v:s.total,c:"var(--p1)"},
    {ic:"&#128309;",lb:"جديد",v:s.new_,c:"#1d4ed8"},
    {ic:"&#128993;",lb:"قيد التنفيذ",v:s.prog,c:"var(--acc)"},
    {ic:"&#128994;",lb:"مكتمل",v:s.done,c:"var(--p1)"},
    {ic:"&#128308;",lb:"مرفوض",v:s.rej,c:"var(--r1)"},
    {ic:"&#9200;",lb:"متأخرة",v:s.overdue,c:"#ea580c"}
  ];
  cards.forEach(function(c) { h += "<div class='sc'><div class='si'>" + c.ic + "</div><div class='sv' style='color:" + c.c + "'>" + c.v + "</div><div class='sl'>" + c.lb + "</div></div>"; });
  h += "</div><div style='display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px'>";
  h += "<div class='card cb'><div style='font-weight:700;margin-bottom:12px'>توزيع الاولويات</div>";
  [{n:"عالي",c:"#f43f5e"},{n:"متوسط",c:"#f59e0b"},{n:"منخفض",c:"#22c55e"}].forEach(function(p) {
    var cnt = pm[p.n]||0, pct = s.total ? Math.round(cnt/s.total*100) : 0;
    h += "<div style='margin-bottom:10px'><div style='display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px'><span>" + p.n + "</span><span style='color:var(--g5)'>" + cnt + " (" + pct + "%)</span></div>";
    h += "<div class='pbg'><div class='pb' style='width:" + pct + "%;background:" + p.c + "'></div></div></div>";
  });
  h += "</div><div class='card cb'><div style='font-weight:700;margin-bottom:12px'>توزيع الحالات</div>";
  SO.forEach(function(st) {
    var sc = SS[st]||{}, cnt = sm[st]||0;
    h += "<div style='display:flex;align-items:center;justify-content:space-between;padding:7px 11px;border-radius:7px;margin-bottom:5px;background:" + sc.bg + "'>";
    h += "<span style='font-weight:600;color:" + sc.tx + ";font-size:13px'>" + st + "</span><span style='font-weight:700;color:" + sc.tx + "'>" + cnt + "</span></div>";
  });
  h += "</div></div>";
  if (s.overdue_list && s.overdue_list.length) {
    h += "<div class='card cb' style='border:1.5px solid var(--acc3)'><div style='font-weight:700;color:var(--acc);margin-bottom:10px'>سجلات متأخرة (" + s.overdue_list.length + ")</div>";
    s.overdue_list.forEach(function(r) {
      var days = Math.floor((Date.now()-new Date(r.created_at))/86400000);
      h += "<div style='display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--acc2)'>";
      h += "<div><div style='font-weight:600;font-size:13px'>" + r.id + "</div><div style='font-size:11px;color:var(--g5)'>" + esc(r.type) + " - " + esc(r.civil_id) + "</div></div>";
      h += "<div style='font-size:12px;color:#ea580c'>منذ " + days + " يوم</div></div>";
    });
    h += "</div>";
  }
  el.innerHTML = h;
}

function renderSettings() {
  var el = document.getElementById("ps");
  if (!ST.su) {
    el.innerHTML = "<div class='card cb'><div class='pg'><div style='font-size:44px'>&#128274;</div><div style='font-weight:700;font-size:17px'>الاعدادات محمية</div><div style='color:var(--g5);font-size:13px'>هذه الصفحة للمدير فقط</div><div style='display:flex;gap:7px;width:100%;max-width:300px'><input class='inp' type='password' id='pinp' placeholder='كلمة السر...' onkeydown='if(event.key==&quot;Enter&quot;)chkp()' style='flex:1'><button class='btn bp' onclick='chkp()'>دخول</button></div><div id='perr' style='color:var(--r1);font-size:13px;display:none'>كلمة السر غير صحيحة</div></div></div>";
    return;
  }
  var h = "<div class='tb' style='margin-bottom:18px'><div><h2>الاعدادات</h2><p>ادارة الموظفين وانواع المعاملات</p></div></div>";
  h += "<div class='card cb' style='margin-bottom:14px'><div class='stitle'>الموظفون</div><div class='tlist'>";
  ST.emps.forEach(function(e) { h += "<span class='tag'>" + esc(e) + "<button class='tdel' data-n='" + esc(e) + "' onclick='demp(this.dataset.n)'>&#215;</button></span>"; });
  h += "</div><div class='arow'><input class='inp' id='nemp' placeholder='اسم الموظف الجديد...' style='flex:1;max-width:270px'><button class='btn bp bsm' onclick='aemp()'>+ اضافة</button></div></div>";
  h += "<div class='card cb'><div class='stitle'>انواع المعاملات</div><div class='tlist'>";
  ST.types.forEach(function(t) { h += "<span class='tag'>" + esc(t) + "<button class='tdel' data-n='" + esc(t) + "' onclick='dtyp(this.dataset.n)'>&#215;</button></span>"; });
  h += "</div><div class='arow'><input class='inp' id='ntyp' placeholder='نوع المعاملة الجديد...' style='flex:1;max-width:270px'><button class='btn bp bsm' onclick='atyp()'>+ اضافة</button></div></div>";
  el.innerHTML = h;
}

async function chkp() {
  var p = document.getElementById("pinp").value;
  var r = await fetch("/api/auth", {headers:{"x-pass":p}});
  var d = await r.json();
  if (d.ok) { ST.su = true; renderSettings(); }
  else { document.getElementById("perr").style.display = ""; }
}
async function aemp() { var i=document.getElementById("nemp"),n=i.value.trim();if(!n)return;var r=await api("POST","/employees",{name:n});if(!r.success){toast(r.error,"#b45309");return;}i.value="";await loadEmps();renderSettings();toast("تمت الاضافة"); }
async function demp(n) { await api("DELETE","/employees/"+encodeURIComponent(n));await loadEmps();renderSettings(); }
async function atyp() { var i=document.getElementById("ntyp"),n=i.value.trim();if(!n)return;var r=await api("POST","/types",{name:n});if(!r.success){toast(r.error,"#b45309");return;}i.value="";await loadTypes();renderSettings();toast("تمت الاضافة"); }
async function dtyp(n) { await api("DELETE","/types/"+encodeURIComponent(n));await loadTypes();renderSettings(); }

function openAdd()     { ST.fm="add";ST.ed=null;renderForm(); }
function openEdit(id)  { var r=ST.recs.find(function(x){return x.id===id;});if(!r)return;ST.fm="edit";ST.ed=r;ST.did=null;renderForm(); }
async function openDetail(id) { ST.did=id;await renderDetail(); }
function cfm()         { ST.fm=null;ST.ed=null;renderPage(); }

async function qst(id, status) {
  var r = await api("PATCH","/records/"+id+"/status",{status:status});
  if (!r.success) return;
  var i = ST.recs.findIndex(function(x){return x.id===id;});
  if (i !== -1) ST.recs[i] = r.data;
  toast("تم تحديث الحالة");
}
async function qstd(id, status) {
  await qst(id, status);
  ST.did = id; await renderDetail();
}
function cdel(id) {
  document.getElementById("mbg").style.display = "flex";
  var h = "<div style='padding:26px 22px;text-align:center'>";
  h += "<div style='font-size:38px;margin-bottom:8px'>&#9888;&#65039;</div>";
  h += "<div style='font-weight:700;font-size:16px;margin-bottom:7px'>تأكيد الحذف</div>";
  h += "<div style='color:var(--g5);font-size:13px;margin-bottom:20px'>هل أنت متأكد من حذف السجل <strong>" + id + "</strong>؟</div>";
  h += "<div style='display:flex;gap:9px;justify-content:center'>";
  h += "<button class='btn bd' data-id='" + id + "' onclick='ddel(this.dataset.id)'>حذف</button>";
  h += "<button class='btn bs' onclick='cm()'>الغاء</button></div></div>";
  document.getElementById("mbox").innerHTML = h;
}
async function ddel(id) { cm();await api("DELETE","/records/"+id);toast("تم حذف السجل","#be123c");ST.did=null;ST.fm=null;await renderPage(); }
function cm() { document.getElementById("mbg").style.display="none"; }

var _dbt;
function dbs() { clearTimeout(_dbt); _dbt = setTimeout(apf, 320); }
async function apf() { await loadRecs(); renderTbl(); }
function clf() { FLT={status:"",priority:"",employee:"",search:"",sort:"desc"}; apf(); }
async function tgsort() { FLT.sort = FLT.sort==="desc"?"asc":"desc"; await apf(); }

document.addEventListener("keydown", function(e) {
  if (e.key === "Escape") { cm(); if (ST.fm||ST.did) cfm(); if (document.getElementById("lb").style.display==="flex") document.getElementById("lb").style.display="none"; }
});


function doLogin() {
  var u = document.getElementById("lusername").value.trim();
  var p = document.getElementById("lpassword").value.trim();
  if (u === "records" && p === "1234") {
    document.getElementById("loginbg").style.display = "none";
    sessionStorage.setItem("loggedin","1");
  } else {
    document.getElementById("loginerr").style.display = "block";
  }
}

// Check if already logged in
if (sessionStorage.getItem("loggedin") === "1") {
  document.addEventListener("DOMContentLoaded", function() {
    var lb = document.getElementById("loginbg");
    if (lb) lb.style.display = "none";
  });
}

init();
</script>

<div id="loginbg" class="login-bg">
  <div class="login-box">
    <img src="data:image/jpeg;base64,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V6TkZMVkLvKyf2xBTJzW8k/bwHmyev3GSXX7kkkd4kMdfDP7bBLv1nrIcmP22SDZkz6T1kTgftqSR3jIzrIzWL+3iJ95P7joOP3Lw4JT4P/ZICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIA==" alt="صندوق الحماية الاجتماعية" style="height:80px;object-fit:contain;margin:0 auto 16px;display:block">
    <div class="login-title">نظام تتبع الطلبات</div>
    <div class="login-sub">صندوق الحماية الاجتماعية<br>الرجاء تسجيل الدخول للمتابعة</div>
    <div class="login-err" id="loginerr">اسم المستخدم أو كلمة السر غير صحيحة</div>
    <div style="margin-bottom:14px;text-align:right">
      <label class="lbl">اسم المستخدم</label>
      <input class="inp" id="lusername" placeholder="ادخل اسم المستخدم" onkeydown="if(event.key==='Enter')doLogin()">
    </div>
    <div style="margin-bottom:22px;text-align:right">
      <label class="lbl">كلمة السر</label>
      <input class="inp" type="password" id="lpassword" placeholder="ادخل كلمة السر" onkeydown="if(event.key==='Enter')doLogin()">
    </div>
    <button class="btn bp" style="width:100%;justify-content:center;padding:12px;font-size:15px" onclick="doLogin()">تسجيل الدخول</button>
  </div>
</div>

</body>
</html>`;
}

// ── HTTP SERVER ──────────────────────────────────────────────────────────────
const HTML = buildHTML();

const server = http.createServer(async (req, res) => {
  const p  = url.parse(req.url, true);
  const pn = p.pathname;
  const m  = req.method.toUpperCase();

  if (m === 'OPTIONS') {
    res.writeHead(204, {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type,x-pass'});
    return res.end();
  }

  try {
    if (pn==='/api/employees' && m==='GET')  return jres(res, {success:true, data:(await db.query('SELECT name FROM employees ORDER BY id')).rows.map(r=>r.name)});
    if (pn==='/api/employees' && m==='POST') {
      const b = await getBody(req);
      if (!b.name?.trim()) return jres(res, {success:false,error:'الاسم مطلوب'}, 400);
      try { await db.query('INSERT INTO employees(name) VALUES($1)', [b.name.trim()]); return jres(res, {success:true}); }
      catch { return jres(res, {success:false,error:'الاسم موجود مسبقاً'}, 409); }
    }
    const em = pn.match(/^\/api\/employees\/(.+)$/);
    if (em && m==='DELETE') { await db.query('DELETE FROM employees WHERE name=$1', [decodeURIComponent(em[1])]); return jres(res, {success:true}); }

    if (pn==='/api/types' && m==='GET')  return jres(res, {success:true, data:(await db.query('SELECT name FROM types ORDER BY id')).rows.map(r=>r.name)});
    if (pn==='/api/types' && m==='POST') {
      const b = await getBody(req);
      if (!b.name?.trim()) return jres(res, {success:false,error:'الاسم مطلوب'}, 400);
      try { await db.query('INSERT INTO types(name) VALUES($1)', [b.name.trim()]); return jres(res, {success:true}); }
      catch { return jres(res, {success:false,error:'النوع موجود'}, 409); }
    }
    const tm = pn.match(/^\/api\/types\/(.+)$/);
    if (tm && m==='DELETE') { await db.query('DELETE FROM types WHERE name=$1', [decodeURIComponent(tm[1])]); return jres(res, {success:true}); }

    if (pn==='/api/auth' && m==='GET') return jres(res, {ok: req.headers['x-pass'] === SETTINGS_PASS});

    if (pn==='/api/stats' && m==='GET') {
      const ago = new Date(Date.now()-3*86400000).toISOString();
      const [t,nw,pr,dn,rj,ov,bp,ol] = await Promise.all([
        db.query('SELECT COUNT(*) as c FROM records'),
        db.query("SELECT COUNT(*) as c FROM records WHERE status='جديد'"),
        db.query("SELECT COUNT(*) as c FROM records WHERE status='قيد التنفيذ'"),
        db.query("SELECT COUNT(*) as c FROM records WHERE status='مكتمل'"),
        db.query("SELECT COUNT(*) as c FROM records WHERE status='مرفوض'"),
        db.query("SELECT COUNT(*) as c FROM records WHERE status NOT IN('مكتمل','مرفوض') AND created_at<$1",[ago]),
        db.query('SELECT priority,COUNT(*) as n FROM records GROUP BY priority'),
        db.query("SELECT * FROM records WHERE status NOT IN('مكتمل','مرفوض') AND created_at<$1 ORDER BY created_at",[ago]),
      ]);
      return jres(res, {success:true, data:{
        total:Number(t.rows[0].c), new_:Number(nw.rows[0].c), prog:Number(pr.rows[0].c),
        done:Number(dn.rows[0].c), rej:Number(rj.rows[0].c), overdue:Number(ov.rows[0].c),
        by_prio:bp.rows.map(r=>({priority:r.priority,n:Number(r.n)})),
        overdue_list:ol.rows,
      }});
    }

    if (pn==='/api/records' && m==='GET') {
      let sql = 'SELECT * FROM records WHERE 1=1'; const pp = [];
      if (p.query.status)   { pp.push(p.query.status);   sql += ' AND status=$'+pp.length; }
      if (p.query.priority) { pp.push(p.query.priority); sql += ' AND priority=$'+pp.length; }
      if (p.query.employee) { pp.push(p.query.employee); sql += ' AND employee=$'+pp.length; }
      if (p.query.search)   { pp.push('%'+p.query.search+'%'); sql += ' AND (id ILIKE $'+pp.length+' OR civil_id ILIKE $'+pp.length+')'; }
      sql += p.query.sort==='asc' ? ' ORDER BY created_at ASC' : ' ORDER BY created_at DESC';
      const rows = (await db.query(sql, pp)).rows;
      return jres(res, {success:true, data:rows, total:rows.length});
    }

    if (pn==='/api/records' && m==='POST') {
      const b = await getBody(req);
      if (!String(b.civil_id||'').trim()) return jres(res, {success:false,error:'الرقم المدني مطلوب'}, 400);
      if (!String(b.type||'').trim())     return jres(res, {success:false,error:'نوع المعاملة مطلوب'}, 400);
      const id = await uid(), ts = now();
      await db.query('INSERT INTO records(id,civil_id,full_name,type,status,priority,employee,notes,modified_by,modified_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [id, String(b.civil_id).trim(), b.full_name||'', String(b.type).trim(), b.status||'جديد', b.priority||'متوسط', b.employee||'', b.notes||'', b.modified_by||'', b.modified_at||'', ts, ts]);
      const row = (await db.query('SELECT * FROM records WHERE id=$1',[id])).rows[0];
      return jres(res, {success:true, data:row}, 201);
    }

    const rm = pn.match(/^\/api\/records\/([^\/]+)$/);
    if (rm) {
      const id  = decodeURIComponent(rm[1]);
      const row = (await db.query('SELECT * FROM records WHERE id=$1',[id])).rows[0];
      if (m==='GET') {
        if (!row) return jres(res, {success:false,error:'غير موجود'}, 404);
        const atts = (await db.query('SELECT * FROM attachments WHERE record_id=$1 ORDER BY created_at DESC',[id])).rows;
        return jres(res, {success:true, data:{...row, attachments:atts}});
      }
      if (m==='PUT') {
        if (!row) return jres(res, {success:false,error:'غير موجود'}, 404);
        const b   = await getBody(req);
        const cid = b.civil_id!==undefined ? String(b.civil_id).trim() : row.civil_id;
        const typ = b.type!==undefined     ? String(b.type).trim()     : row.type;
        if (!cid) return jres(res, {success:false,error:'الرقم المدني مطلوب'}, 400);
        if (!typ) return jres(res, {success:false,error:'نوع المعاملة مطلوب'}, 400);
        await db.query('UPDATE records SET civil_id=$1,full_name=$2,type=$3,status=$4,priority=$5,employee=$6,notes=$7,modified_by=$8,modified_at=$9,updated_at=$10 WHERE id=$11',
          [cid, b.full_name??row.full_name, typ, b.status??row.status, b.priority??row.priority, b.employee??row.employee, b.notes??row.notes, b.modified_by??row.modified_by, b.modified_at??row.modified_at, now(), id]);
        const updated = (await db.query('SELECT * FROM records WHERE id=$1',[id])).rows[0];
        return jres(res, {success:true, data:updated});
      }
      if (m==='DELETE') {
        if (!row) return jres(res, {success:false,error:'غير موجود'}, 404);
        const atts = (await db.query('SELECT filename FROM attachments WHERE record_id=$1',[id])).rows;
        atts.forEach(a => { try { fs.unlinkSync(path.join(UPLOADS_DIR,a.filename)); } catch {} });
        await db.query('DELETE FROM attachments WHERE record_id=$1',[id]);
        await db.query('DELETE FROM records WHERE id=$1',[id]);
        return jres(res, {success:true});
      }
    }

    const sm = pn.match(/^\/api\/records\/([^\/]+)\/status$/);
    if (sm && m==='PATCH') {
      const b = await getBody(req), id = decodeURIComponent(sm[1]);
      await db.query('UPDATE records SET status=$1,updated_at=$2 WHERE id=$3',[b.status, now(), id]);
      const row = (await db.query('SELECT * FROM records WHERE id=$1',[id])).rows[0];
      return jres(res, {success:true, data:row});
    }

    const am = pn.match(/^\/api\/records\/([^\/]+)\/attachments$/);
    if (am && m==='POST') {
      console.log('Upload request received for:', decodeURIComponent(am[1]));
      const id = decodeURIComponent(am[1]);
      const recCheck = (await db.query('SELECT id FROM records WHERE id=$1',[id])).rows[0];
      if (!recCheck) return jres(res, {success:false,error:'غير موجود'}, 404);
      const {files} = await getMultipart(req);
      console.log('Files found:', files.length, 'Content-Type:', req.headers['content-type']);
      if (!files.length) return jres(res, {success:false,error:'لا يوجد ملف - تأكد من اختيار صورة'}, 400);
      const f   = files[0];
      const ext = (path.extname(f.filename)||'.bin').toLowerCase();
      if (!['.jpg','.jpeg','.png','.gif','.webp','.pdf'].includes(ext)) return jres(res, {success:false,error:'نوع غير مسموح'}, 400);
      const fn  = Date.now()+'-'+Math.random().toString(36).slice(2)+ext;
      fs.writeFileSync(path.join(UPLOADS_DIR,fn), f.data);
      await db.query('INSERT INTO attachments(record_id,filename,original,created_at) VALUES($1,$2,$3,$4)',[id,fn,f.filename,now()]);
      const att = (await db.query('SELECT * FROM attachments WHERE filename=$1',[fn])).rows[0];
      return jres(res, {success:true, data:att}, 201);
    }

    const dm = pn.match(/^\/api\/attachments\/(\d+)$/);
    if (dm && m==='DELETE') {
      const att = (await db.query('SELECT * FROM attachments WHERE id=$1',[Number(dm[1])])).rows[0];
      if (att) { try { fs.unlinkSync(path.join(UPLOADS_DIR,att.filename)); } catch {} await db.query('DELETE FROM attachments WHERE id=$1',[Number(dm[1])]); }
      return jres(res, {success:true});
    }

    const fm = pn.match(/^\/uploads\/(.+)$/);
    if (fm && m==='GET') {
      const fp  = path.join(UPLOADS_DIR, path.basename(fm[1]));
      if (!fs.existsSync(fp)) { res.writeHead(404); return res.end('Not found'); }
      const ext = path.extname(fm[1]).toLowerCase();
      const mt  = {'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif','.webp':'image/webp','.pdf':'application/pdf'};
      res.writeHead(200, {'Content-Type': mt[ext]||'application/octet-stream'});
      return fs.createReadStream(fp).pipe(res);
    }

    if (m==='GET' && (pn==='/'||pn==='/index.html')) {
      res.writeHead(200, {'Content-Type':'text/html;charset=utf-8'});
      return res.end(HTML);
    }

    jres(res, {error:'Not Found'}, 404);
  } catch(e) {
    console.error('Server Error:', e.message, '\nStack:', e.stack);
    jres(res, {error:'Server Error: ' + e.message}, 500);
  }
});

initDB().then(() => {
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n================================================');
  console.log('   نظام ادارة السجلات - جاهز');
  console.log('================================================');
  console.log('  المتصفح:   http://localhost:' + PORT);
  console.log('  الشبكة:    http://<IP>:' + PORT);
  console.log('  الاعدادات: كلمة السر = ' + SETTINGS_PASS);
  console.log('  اوقف:      Ctrl+C\n');
});
}).catch(err => { console.error('DB connection failed:', err); process.exit(1); });
process.on('SIGINT', () => { db.end(); process.exit(0); });
