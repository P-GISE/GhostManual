import java.awt.Color;
import java.awt.image.BufferedImage;
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
  static boolean dark(int rgb) {
    return ((rgb>>16)&255)+((rgb>>8)&255)+(rgb&255)<420;
  }
  static List<Integer> rules(int[] ink,int first,int last,int span) {
    List<Integer> result=new ArrayList<>();
    for(int i=first;i<=last;i++){
      if(ink[i]*100<span*85)continue;
      int start=i;
      while(i<last && ink[i+1]*100>=span*85)i++;
      result.add((start+i)/2);
    }
    return result;
  }
  static String ocrPage(BufferedImage page) throws Exception {
    int width=page.getWidth(),height=page.getHeight();
    int[] columns=new int[width],rows=new int[height],pixels=new int[width];
    int left=width,right=-1,top=height,bottom=-1;
    for(int y=0;y<height;y++){
      page.getRGB(0,y,width,1,pixels,0,width);
      for(int x=0;x<width;x++){
        if(!dark(pixels[x]))continue;
        columns[x]++;rows[y]++;
        left=Math.min(left,x);right=Math.max(right,x);
        top=Math.min(top,y);bottom=y;
      }
    }
    if(right<left)return "";
    int inkWidth=right-left+1,inkHeight=bottom-top+1;
    List<Integer> vertical=rules(columns,left,right,inkHeight);
    List<Integer> horizontal=rules(rows,top,bottom,inkWidth);
    // shortcut: detect fully ruled grids only, extend when merged or borderless cells are supported.
    if(vertical.size()>=3 && horizontal.size()>=3 && (vertical.size()-1)*(horizontal.size()-1)<=16
        && vertical.get(0)-left<=8 && right-vertical.get(vertical.size()-1)<=8
        && horizontal.get(0)-top<=8 && bottom-horizontal.get(horizontal.size()-1)<=8
        && spaced(vertical) && spaced(horizontal)){
      StringJoiner table=new StringJoiner("\n","","\n");
      for(int row=1;row<horizontal.size();row++){
        StringJoiner cells=new StringJoiner("\t");
        for(int col=1;col<vertical.size();col++){
          cells.add(ocrCell(page,vertical.get(col-1)+5,horizontal.get(row-1)+5,
              vertical.get(col)-5,horizontal.get(row)-5));
        }
        table.add(cells.toString());
      }
      return table.toString();
    }
    int gutterStart=-1,gutterEnd=-1;
    for(int x=left+1;x<right;x++){
      if(columns[x]!=0)continue;
      int start=x;
      while(x<right && columns[x]==0)x++;
      int center=(start+x)/2;
      if(x-start>=width/20 && center>=width*2/5 && center<=width*3/5
          && start-left>=width/5 && right-x>=width/5 && x-start>gutterEnd-gutterStart){
        gutterStart=start;gutterEnd=x;
      }
    }
    if(gutterStart>=0){
      return ocrRegion(page,left,top,gutterStart,bottom+1,"6").strip()
          +"\n\n"+ocrRegion(page,gutterEnd,top,right+1,bottom+1,"6").strip()+"\n";
    }
    return runOcr(page,"11");
  }
  static boolean spaced(List<Integer> rules) {
    for(int i=1;i<rules.size();i++)if(rules.get(i)-rules.get(i-1)<24)return false;
    return true;
  }
  static String ocrCell(BufferedImage page,int left,int top,int right,int bottom) throws Exception {
    List<int[]> lines=new ArrayList<>();
    int start=-1,last=-1;
    for(int y=top;y<bottom;y++){
      boolean ink=false;
      for(int x=left;x<right && !ink;x++)ink=dark(page.getRGB(x,y));
      if(!ink)continue;
      if(y-last>8 && start>=0){
        lines.add(new int[]{start,last+1});
        start=-1;
      }
      if(start<0)start=y;
      last=y;
    }
    if(start<0)return "";
    if(lines.isEmpty())return ocrRegion(page,left,top,right,bottom,"7").strip();
    lines.add(new int[]{start,last+1});
    if(lines.size()>3)return ocrRegion(page,left,top,right,bottom,"6").strip().replace('\n',' ');
    StringJoiner text=new StringJoiner(" ");
    for(int[] line:lines)text.add(ocrRegion(page,left,line[0],right,line[1],"7").strip());
    return text.toString();
  }
  static String ocrRegion(BufferedImage page,int left,int top,int right,int bottom,String mode) throws Exception {
    int padding=12;
    var crop=new BufferedImage(right-left+2*padding,bottom-top+2*padding,BufferedImage.TYPE_INT_RGB);
    var graphics=crop.createGraphics();
    try{
      graphics.setColor(Color.WHITE);graphics.fillRect(0,0,crop.getWidth(),crop.getHeight());
      graphics.drawImage(page.getSubimage(left,top,right-left,bottom-top),padding,padding,null);
    }finally{graphics.dispose();}
    return runOcr(crop,mode);
  }
  static String runOcr(BufferedImage raster,String mode) throws Exception {
    Path image=Path.of("/tmp/page.png");
    ImageIO.write(raster,"png",image.toFile());
    Process process=new ProcessBuilder("/usr/bin/tesseract",image.toString(),"stdout","-l","kor+eng","--psm",mode)
        .redirectError(ProcessBuilder.Redirect.DISCARD).start();
    try{
      byte[] result=process.getInputStream().readNBytes(800001);
      if(result.length>800000)throw new Limit();
      if(!process.waitFor(60,TimeUnit.SECONDS) || process.exitValue()!=0)throw new IOException();
      return new String(result,StandardCharsets.UTF_8);
    }finally{
      if(process.isAlive())process.destroyForcibly();
      Files.deleteIfExists(image);
    }
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
          text=ocrPage(renderer.renderImageWithDPI(i,150));
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
