import assert from "node:assert/strict";
import test from "node:test";
import { prescriptionFileSignatureMatches, validatePrescriptionUpload } from "./prescription-files.ts";

const NUL = String.fromCharCode(0);
const pdf = () => Buffer.from("%PDF-1.7 body");
const png = () => Buffer.concat([Buffer.from([0x89]), Buffer.from("PNG"), Buffer.from([13,10,26,10])]);
const jpeg = () => Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]), Buffer.from("JFIF")]);
const webp = () => Buffer.concat([Buffer.from("RIFF"), Buffer.from([0,0,0,0]), Buffer.from("WEBP")]);
const avif = () => Buffer.concat([Buffer.from([0,0,0,0]), Buffer.from("ftyp"), Buffer.from("avif")]);
const tiffLittle = () => Buffer.from("II*" + NUL);
const tiffBig = () => Buffer.from("MM" + NUL + "*");

test("each accepted format is recognised by its leading bytes",()=>{
  assert.equal(prescriptionFileSignatureMatches(pdf(),"application/pdf"),true);
  assert.equal(prescriptionFileSignatureMatches(png(),"image/png"),true);
  assert.equal(prescriptionFileSignatureMatches(jpeg(),"image/jpeg"),true);
  assert.equal(prescriptionFileSignatureMatches(webp(),"image/webp"),true);
  assert.equal(prescriptionFileSignatureMatches(avif(),"image/avif"),true);
  assert.equal(prescriptionFileSignatureMatches(tiffLittle(),"image/tiff"),true);
  assert.equal(prescriptionFileSignatureMatches(tiffBig(),"image/tiff"),true);
});

test("a declared content type cannot override the real bytes",()=>{
  // The classic bypass: a script or HTML page renamed and announced as an image.
  assert.equal(prescriptionFileSignatureMatches(Buffer.from("<script>x()</script>"),"image/png"),false);
  assert.equal(prescriptionFileSignatureMatches(Buffer.from("GIF89a"),"application/pdf"),false);
  assert.equal(prescriptionFileSignatureMatches(pdf(),"image/jpeg"),false);
  assert.equal(prescriptionFileSignatureMatches(png(),"application/pdf"),false);
});

test("unsupported formats are refused before any bytes are read",async()=>{
  const result=await validatePrescriptionUpload(new File([Buffer.from("MZ")],"x.exe",{type:"application/x-msdownload"}));
  assert.equal(result.ok,false);
  assert.equal(result.ok===false&&result.status,415);
});

test("empty and oversized documents are refused",async()=>{
  const empty=await validatePrescriptionUpload(new File([],"x.pdf",{type:"application/pdf"}));
  assert.equal(empty.ok,false);
  assert.equal(empty.ok===false&&empty.status,413);

  const huge=await validatePrescriptionUpload(new File([Buffer.alloc(10*1024*1024+1)],"x.pdf",{type:"application/pdf"}));
  assert.equal(huge.ok,false);
  assert.equal(huge.ok===false&&huge.status,413);
});

test("a mismatched document is refused with a content error",async()=>{
  const result=await validatePrescriptionUpload(new File([Buffer.from("not really a pdf")],"x.pdf",{type:"application/pdf"}));
  assert.equal(result.ok,false);
  assert.equal(result.ok===false&&result.status,400);
});

test("a genuine document is accepted and keeps its extension",async()=>{
  const result=await validatePrescriptionUpload(new File([pdf()],"script.pdf",{type:"application/pdf"}));
  assert.equal(result.ok,true);
  assert.equal(result.ok===true&&result.extension,".pdf");
  assert.equal(result.ok===true&&result.bytes.length>0,true);
});
