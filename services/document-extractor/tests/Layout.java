import java.awt.*;
import java.awt.image.*;
import org.apache.pdfbox.pdmodel.*;
import org.apache.pdfbox.pdmodel.graphics.image.*;
class Layout {
 public static void main(String[] args) throws Exception {
  for (String type : new String[]{"table", "columns"}) {
   var img = new BufferedImage(1800, 1000, BufferedImage.TYPE_INT_RGB);
   var g = img.createGraphics();
   g.setColor(Color.WHITE);g.fillRect(0,0,1800,1000);
   g.setColor(Color.BLACK);g.setFont(new Font("Noto Sans CJK KR",Font.PLAIN,60));
   if(type.equals("table")){
    g.setStroke(new BasicStroke(4));g.drawRect(75,80,1500,660);g.drawLine(800,80,800,740);
    g.drawLine(75,300,1575,300);g.drawLine(75,520,1575,520);
    g.drawString("구분",120,220);g.drawString("내용",850,220);
    g.drawString("신청",120,440);g.drawString("서류 제출",850,440);
    g.drawString("검토",120,660);g.drawString("결과 안내",850,615);
    g.drawString("문서 보관",850,695);
   }else{
    g.drawString("왼쪽 첫 번째 문장",120,220);g.drawString("왼쪽 두 번째 문장",120,360);
    g.drawString("오른쪽 첫 번째 문장",980,220);g.drawString("오른쪽 두 번째 문장",980,360);
   }
   g.dispose();
   try(var doc = new PDDocument()){
    var page = new PDPage();doc.addPage(page);
    try(var stream = new PDPageContentStream(doc,page)){stream.drawImage(LosslessFactory.createFromImage(doc,img),0,450,600,333);}
    doc.save(args[0] + "/" + type + ".pdf");
   }
  }
 }
}
