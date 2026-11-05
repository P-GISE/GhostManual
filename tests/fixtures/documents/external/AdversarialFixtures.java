import java.io.*;
import java.nio.file.*;
import java.util.zip.*;
import org.apache.poi.poifs.filesystem.*;
import org.apache.poi.hslf.usermodel.*;
import org.apache.pdfbox.pdmodel.*;
import org.apache.pdfbox.cos.*;
import org.apache.pdfbox.pdmodel.encryption.*;
import org.apache.pdfbox.pdmodel.interactive.annotation.PDAnnotationLink;
import org.apache.poi.hslf.record.VBAInfoAtom;
import org.apache.poi.hslf.record.RecordTypes;
import org.apache.poi.util.LittleEndian;
public class AdversarialFixtures {
 public static void main(String[] args)throws Exception{
  Path dir=Path.of(args[0]);
  for(String kind:new String[]{"protected","expanded"})try(POIFSFileSystem fs=new POIFSFileSystem(Files.newInputStream(dir.resolve("sample-v1.hwp")))){
   byte[] header;try(DocumentInputStream in=fs.getRoot().createDocumentInputStream("FileHeader")){header=in.readAllBytes();}
   fs.getRoot().getEntry("FileHeader").delete();header[36]=(byte)(kind.equals("protected")?2:1);fs.createDocument(new ByteArrayInputStream(header),"FileHeader");
   if(kind.equals("expanded")){
    DirectoryEntry body=(DirectoryEntry)fs.getRoot().getEntry("BodyText");body.getEntry("Section0").delete();ByteArrayOutputStream packed=new ByteArrayOutputStream();
    try(DeflaterOutputStream out=new DeflaterOutputStream(packed,new Deflater(9,true))){byte[] chunk=new byte[65536];for(int i=0;i<400;i++)out.write(chunk);}
    body.createDocument("Section0",new ByteArrayInputStream(packed.toByteArray()));
   }
   try(OutputStream out=Files.newOutputStream(dir.resolve(kind+".hwp"))){fs.writeFilesystem(out);}
  }
  for(String kind:new String[]{"macro","embedded"})try(POIFSFileSystem fs=new POIFSFileSystem(Files.newInputStream(dir.resolve("office-v1.doc")))){
   DirectoryEntry target=kind.equals("macro")?fs.getRoot().createDirectory("VBA"):(DirectoryEntry)fs.getRoot().getEntry("ObjectPool");
   target.createDocument("Object",new ByteArrayInputStream(new byte[]{1,2,3}));
   try(OutputStream out=Files.newOutputStream(dir.resolve(kind+".doc"))){fs.writeFilesystem(out);}
  }
  try(PDDocument doc=new PDDocument()){
   for(int i=0;i<21;i++)doc.addPage(new PDPage());doc.save(dir.resolve("pages21.pdf").toFile());
  }
  try(PDDocument doc=new PDDocument()){
   doc.addPage(new PDPage());doc.getDocumentCatalog().getCOSObject().setItem(COSName.getPDFName("OpenAction"),new COSString("synthetic action"));doc.save(dir.resolve("active.pdf").toFile());
  }
  try(PDDocument doc=new PDDocument()){
   doc.addPage(new PDPage());StandardProtectionPolicy policy=new StandardProtectionPolicy("fixture-owner","fixture-user",new AccessPermission());policy.setEncryptionKeyLength(128);doc.protect(policy);doc.save(dir.resolve("encrypted.pdf").toFile());
  }
  for(String action:new String[]{"Launch","SubmitForm","ImportData"})try(PDDocument doc=org.apache.pdfbox.Loader.loadPDF(dir.resolve("text-v1.pdf").toFile())){
   PDAnnotationLink link=new PDAnnotationLink();
   COSDictionary dictionary=new COSDictionary();dictionary.setName(COSName.S,action);dictionary.setString(COSName.F,"synthetic-target");
   link.getCOSObject().setItem(COSName.A,dictionary);doc.getPage(0).getAnnotations().add(link);
   doc.save(dir.resolve("annotation-"+action+".pdf").toFile());
  }
  try(HSLFSlideShow show=new HSLFSlideShow(Files.newInputStream(dir.resolve("slides-v1.ppt")));POIFSFileSystem embedded=new POIFSFileSystem(Files.newInputStream(dir.resolve("office-v1.doc")))){
   embedded.getRoot().setStorageClsid(org.apache.poi.hpsf.ClassIDPredefined.WORD_V8.getClassID());
   show.addEmbed(embedded);
   try(OutputStream out=Files.newOutputStream(dir.resolve("embedded.ppt"))){show.write(out);}
  }
  try(HSLFSlideShow show=new HSLFSlideShow(Files.newInputStream(dir.resolve("embedded.ppt")))){
   if(show.getEmbeddedObjects().length!=1)throw new Exception("Fixture missing ExOleObjStg");
  }
  try(HSLFSlideShow show=new HSLFSlideShow(Files.newInputStream(dir.resolve("slides-v1.ppt")))){
   byte[] record=new byte[20];LittleEndian.putShort(record,2,(short)RecordTypes.VBAInfoAtom.typeID);LittleEndian.putInt(record,4,12);LittleEndian.putInt(record,12,1);LittleEndian.putInt(record,16,2);
   show.getDocumentRecord().appendChildRecord(new VBAInfoAtom(record,0,record.length));
   try(OutputStream out=Files.newOutputStream(dir.resolve("macro.ppt"))){show.write(out);}
  }
  try(HSLFSlideShow show=new HSLFSlideShow()){
   for(int i=0;i<21;i++)show.createSlide();try(OutputStream out=Files.newOutputStream(dir.resolve("slides21.ppt"))){show.write(out);}
  }
 }
}
