import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.*;
import javax.imageio.ImageIO;
import org.apache.poi.poifs.filesystem.*;
import org.apache.poi.hwpf.HWPFDocument;
import org.apache.poi.hwpf.usermodel.*;
import org.apache.poi.hslf.usermodel.*;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.*;
import org.apache.pdfbox.cos.*;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.tika.parser.hwp.HwpV5Parser;
import org.apache.tika.parser.ParseContext;
import org.apache.tika.metadata.Metadata;
import org.apache.tika.io.TikaInputStream;
import org.apache.tika.sax.BodyContentHandler;

/** Only invoked by the fixed launcher; never a server, detector, URL fetcher or shell. */
public final class Parser {
  static int chars=0, blocks=0;
  static final AtomicBoolean ocr=new AtomicBoolean(false);
  static void emit(String kind,String path,String text) throws Exception {
    text=text.replace("\r\n","\n").replace('\r','\n');
    chars+=text.length(); blocks++;
    if(chars>200000 || blocks>5000) throw new Limit();
    System.out.println(kind+"\t"+path+"\t"+Base64.getEncoder().encodeToString(text.getBytes(StandardCharsets.UTF_8)));
  }
  static class Limit extends Exception {}
  static class Unsafe extends Exception {}
  static long expanded=0;
  static void inspectOle(DirectoryEntry dir,int depth) throws Exception {
    if(depth>20) throw new Limit();
    for(Entry e:dir) {
      String n=e.getName().toLowerCase(Locale.ROOT);
      if(n.contains("vba") || n.contains("macro") || (n.equals("objectpool") && (!e.isDirectoryEntry() || ((DirectoryEntry)e).getEntryCount()>0)) || n.contains("ole10native") || n.equals("encryptedpackage") || n.equals("encryptioninfo") || n.equals("scripts") || n.equals("bindata")) throw new Unsafe();
      if(e.isDirectoryEntry()) inspectOle((DirectoryEntry)e,depth+1);
      else { expanded+=((DocumentEntry)e).getSize(); if(expanded>20*1024*1024)throw new Limit(); }
    }
  }
  static void hwp(byte[] bytes,POIFSFileSystem fs) throws Exception {
    DirectoryNode root=fs.getRoot();
    byte[] header; try(DocumentInputStream in=root.createDocumentInputStream("FileHeader")){header=in.readNBytes(256);}
    if(header.length!=256 || header[35]!=5 || !new String(header,0,17,StandardCharsets.US_ASCII).equals("HWP Document File")) throw new Unsafe();
    int flags=(header[36]&255)|((header[37]&255)<<8)|((header[38]&255)<<16)|((header[39]&255)<<24);
    if((flags&~1)!=0) throw new Unsafe();
    DirectoryEntry body=(DirectoryEntry)root.getEntry("BodyText");
    int count=0;
    for(Entry e:body){
      if(!e.isDocumentEntry() || !e.getName().matches("Section[0-9]+")) throw new Unsafe();
      if(++count>20) throw new Limit();
      try(InputStream raw=new DocumentInputStream((DocumentEntry)e); InputStream in=(flags&1)!=0?new InflaterInputStream(raw,new Inflater(true)):raw){
        byte[] buffer=new byte[8192]; int n;long size=0;
        while((n=in.read(buffer))!=-1){size+=n;if(size>20*1024*1024)throw new Limit();}
        expanded+=size; if(expanded>20*1024*1024)throw new Limit();
      }
    }
    BodyContentHandler handler=new BodyContentHandler(200000);
    try(TikaInputStream in=TikaInputStream.get(bytes)){new HwpV5Parser().parse(in,handler,new Metadata(),new ParseContext());}
    for(String text:handler.toString().split("\n",-1))if(!text.isBlank())emit("paragraph","paragraph/"+(blocks+1),text);
  }
  static void doc(byte[] bytes) throws Exception {
    try(HWPFDocument doc=new HWPFDocument(new ByteArrayInputStream(bytes))){
      if(doc.getSummaryInformation()!=null && doc.getSummaryInformation().getPageCount()>20)throw new Limit();
      Range range=doc.getRange();
      for(int i=0;i<range.numParagraphs();i++){
        Paragraph p=range.getParagraph(i); StringBuilder text=new StringBuilder();
        for(int j=0;j<p.numCharacterRuns();j++){CharacterRun run=p.getCharacterRun(j);if(!run.isMarkedDeleted()&&!run.isVanished())text.append(run.text());}
        emit("paragraph","paragraph/"+(i+1),text.toString());
      }
    }
  }
  static void shapeText(java.util.List<HSLFShape> shapes,StringBuilder text,int depth) throws Exception {
    if(depth>20)throw new Limit();
    for(HSLFShape shape:shapes){
      if(shape instanceof HSLFTextShape t)text.append(t.getText()).append('\n');
      else if(shape instanceof HSLFGroupShape group)shapeText(group.getShapes(),text,depth+1);
      if(text.length()>200000)throw new Limit();
    }
  }
  static int pptRecords=0;
  static void inspectPptRecords(org.apache.poi.hslf.record.Record[] records,int depth) throws Exception {
    if(depth>20)throw new Limit();
    for(org.apache.poi.hslf.record.Record record:records){
      if(++pptRecords>50000)throw new Limit();
      if(record instanceof org.apache.poi.hslf.record.ExOleObjStg || record instanceof org.apache.poi.hslf.record.ExOleObjAtom)throw new Unsafe();
      if(record instanceof org.apache.poi.hslf.record.VBAInfoAtom vba && (vba.isHasMacros() || vba.getPersistIdRef()!=0))throw new Unsafe();
      if(record instanceof org.apache.poi.hslf.record.RecordContainer container)inspectPptRecords(container.getChildRecords(),depth+1);
    }
  }
  static void ppt(byte[] bytes) throws Exception {
    try(HSLFSlideShow show=new HSLFSlideShow(new ByteArrayInputStream(bytes))){
      if(show.getEmbeddedObjects().length>0)throw new Unsafe();
      inspectPptRecords(show.getSlideShowImpl().getRecords(),0);
      if(show.getSlides().size()>20)throw new Limit();
      for(HSLFSlide slide:show.getSlides()){
        if(slide.isHidden())continue;
        StringBuilder text=new StringBuilder();
        shapeText(slide.getShapes(),text,0);
        emit("slide","slide/"+slide.getSlideNumber(),text.toString());
      }
    }
  }
  static void inspectPdf(COSBase value,Set<COSBase> visited,int depth) throws Exception {
    if(depth>60 || visited.size()>50000)throw new Limit();
    if(value==null || !visited.add(value))return;
    if(value instanceof COSObject obj)inspectPdf(obj.getObject(),visited,depth+1);
    else if(value instanceof COSDictionary dict){
      COSName action=dict.getCOSName(COSName.S);
      if(action!=null && Set.of("Launch","SubmitForm","ImportData","JavaScript","GoToR","GoToE","Rendition","RichMediaExecute").contains(action.getName()))throw new Unsafe();
      for(COSName key:dict.keySet()){
        if(Set.of("JavaScript","JS","Launch","EmbeddedFiles","EF","XFA","RichMedia","OpenAction","AA","SubmitForm","ImportData").contains(key.getName()))throw new Unsafe();
        inspectPdf(dict.getDictionaryObject(key),visited,depth+1);
      }
      if(dict instanceof COSStream stream){try(InputStream in=stream.createInputStream()){byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1){expanded+=n;if(expanded>20*1024*1024)throw new Limit();}}}
    }else if(value instanceof COSArray array)for(COSBase item:array)inspectPdf(item,visited,depth+1);
  }
  static void pdf(byte[] bytes) throws Exception {
    try(PDDocument doc=Loader.loadPDF(bytes)){
      if(doc.isEncrypted())throw new Unsafe();
      if(doc.getNumberOfPages()>20)throw new Limit();
      inspectPdf(doc.getDocumentCatalog().getCOSObject(),Collections.newSetFromMap(new IdentityHashMap<>()),0);
      PDFTextStripper stripper=new PDFTextStripper(); PDFRenderer renderer=new PDFRenderer(doc);
      for(int i=0;i<doc.getNumberOfPages();i++){
        stripper.setStartPage(i+1); stripper.setEndPage(i+1); String text=stripper.getText(doc);
        if(text.isBlank()){
          ocr.set(true); System.out.println("mode\tocr"); System.out.flush();
          var box=doc.getPage(i).getCropBox();
          if(box.getWidth()<=0 || box.getHeight()<=0 || (box.getWidth()*150/72)*(box.getHeight()*150/72)>10000000)throw new Limit();
          Path image=Path.of("/tmp/page.png"); ImageIO.write(renderer.renderImageWithDPI(i,150),"png",image.toFile());
          Process process=new ProcessBuilder("/usr/bin/tesseract",image.toString(),"stdout","-l","kor+eng","--psm","3").redirectError(ProcessBuilder.Redirect.DISCARD).start();
          byte[] result=process.getInputStream().readNBytes(800001);
          if(result.length>800000){process.destroyForcibly();throw new Limit();}
          if(!process.waitFor(60,TimeUnit.SECONDS)){process.destroyForcibly();throw new IOException();}
          if(process.exitValue()!=0)throw new IOException();
          text=new String(result,StandardCharsets.UTF_8); Files.delete(image);
        }
        emit("page","page/"+(i+1),text);
      }
    }
  }
  public static void main(String[] args) {
    Thread watchdog=new Thread(()->{try{Thread.sleep(60000);if(ocr.get())Thread.sleep(60000);Runtime.getRuntime().halt(124);}catch(InterruptedException ignored){}});watchdog.setDaemon(true);watchdog.start();
    try{
      if(args.length!=1 || !Set.of("hwp","doc","ppt","pdf").contains(args[0]))throw new Unsafe();
      byte[] bytes=System.in.readNBytes(5*1024*1024+1);if(bytes.length==0||bytes.length>5*1024*1024)throw new Limit();
      if(args[0].equals("pdf"))pdf(bytes);
      else try(POIFSFileSystem fs=new POIFSFileSystem(new ByteArrayInputStream(bytes))){
        inspectOle(fs.getRoot(),0);
        switch(args[0]){case "hwp"->hwp(bytes,fs);case "doc"->doc(bytes);case "ppt"->ppt(bytes);}
      }
    }catch(Limit e){System.exit(42);}catch(Unsafe e){System.exit(43);}catch(Throwable e){System.exit(44);}
  }
}
