import java.io.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.awt.*;
import java.awt.image.BufferedImage;
import org.apache.poi.poifs.filesystem.*;
import org.apache.poi.hpsf.PropertySetFactory;
import org.apache.poi.hwpf.HWPFDocument;
import org.apache.poi.hslf.usermodel.*;
import org.apache.pdfbox.pdmodel.*;
import org.apache.pdfbox.pdmodel.font.*;
import org.apache.pdfbox.pdmodel.graphics.image.LosslessFactory;

public class GenerateFixtures {
 public static void main(String[] args)throws Exception {
  Path dir=Path.of(args[0]);
  for(int v=1;v<=2;v++) {
   String text="GhostManual synthetic version "+v;
   try(HWPFDocument doc=new HWPFDocument(Files.newInputStream(dir.resolve("empty.doc")))) {
    if(!doc.getRange().text().isBlank())throw new Exception("Template not empty");
    doc.getRange().insertBefore(text+"\r");
    try(OutputStream out=Files.newOutputStream(dir.resolve("office-v"+v+".doc"))){doc.write(out);}
   }
   try(HSLFSlideShow show=new HSLFSlideShow()) {
    HSLFSlide slide=show.createSlide();HSLFTextBox box=new HSLFTextBox();box.setText(text);box.setAnchor(new java.awt.Rectangle(20,20,600,50));slide.addShape(box);HSLFTable table=slide.createTable(1,1);table.getCell(0,0).setText("TABLE CELL "+v);
    HSLFSlide hidden=show.createSlide();hidden.setHidden(true);HSLFTextBox hiddenText=new HSLFTextBox();hiddenText.setText("SECRET_HIDDEN");hidden.addShape(hiddenText);
    try(OutputStream out=Files.newOutputStream(dir.resolve("slides-v"+v+".ppt"))){show.write(out);}
   }
   try(POIFSFileSystem fs=new POIFSFileSystem()) {
    byte[] header=new byte[256];System.arraycopy("HWP Document File".getBytes(StandardCharsets.US_ASCII),0,header,0,17);header[35]=5;
    fs.createDocument(new ByteArrayInputStream(header),"FileHeader");
    var info=PropertySetFactory.newSummaryInformation();info.setPageCount(1);ByteArrayOutputStream meta=new ByteArrayOutputStream();info.write(meta);
    fs.createDocument(new ByteArrayInputStream(meta.toByteArray()),"\u0005HwpSummaryInformation");
    byte[] txt=("한글 합성 문서 "+v).getBytes(StandardCharsets.UTF_16LE);int record=67|(txt.length<<20);ByteArrayOutputStream body=new ByteArrayOutputStream();
    for(int i=0;i<4;i++)body.write((record>>>(i*8))&255);body.write(txt);
    fs.getRoot().createDirectory("BodyText").createDocument("Section0",new ByteArrayInputStream(body.toByteArray()));
    try(OutputStream out=Files.newOutputStream(dir.resolve("sample-v"+v+".hwp"))){fs.writeFilesystem(out);}
   }
   try(PDDocument doc=new PDDocument()) {
    PDPage page=new PDPage();doc.addPage(page);
    try(PDPageContentStream content=new PDPageContentStream(doc,page)){content.beginText();content.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA),16);content.newLineAtOffset(30,700);content.showText(text);content.endText();}
    doc.save(dir.resolve("text-v"+v+".pdf").toFile());
   }
   try(PDDocument doc=new PDDocument()) {
    BufferedImage image=new BufferedImage(1800,500,BufferedImage.TYPE_INT_RGB);Graphics2D g=image.createGraphics();g.setColor(Color.WHITE);g.fillRect(0,0,1800,500);g.setColor(Color.BLACK);g.setFont(new Font("Noto Sans CJK KR",Font.PLAIN,60));g.drawString("한글 합성 문서",60,160);g.drawString("GhostManual version "+v,60,280);g.dispose();
    PDPage page=new PDPage();doc.addPage(page);try(PDPageContentStream content=new PDPageContentStream(doc,page)){content.drawImage(LosslessFactory.createFromImage(doc,image),0,550,600,167);}
    doc.save(dir.resolve("scan-ko-v"+v+".pdf").toFile());
   }
  }
 }
}
