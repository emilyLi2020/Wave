/* Shared minimal markdown viewer. A page sets <body data-md="submission/x.md">.
   Plain on purpose: looks like markdown, auto-refreshes every 4s. */
(function(){
  function esc(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
  function inline(s){
    return esc(s)
      .replace(/`([^`]+)`/g,'<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g,'$1<em>$2</em>')
      .replace(/\[\[([^\]]+)\]\]/g,'<mark>[[$1]]</mark>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2">$1</a>');
  }
  function md(src){
    var lines=src.replace(/\r/g,"").split("\n"),out=[],i=0;
    while(i<lines.length){
      var l=lines[i];
      if(/^```/.test(l)){var b=[];i++;while(i<lines.length&&!/^```/.test(lines[i])){b.push(esc(lines[i]));i++;}i++;out.push("<pre><code>"+b.join("\n")+"</code></pre>");continue;}
      if(/^\s*\|.*\|\s*$/.test(l)&&i+1<lines.length&&/^\s*\|[-:\s|]+\|\s*$/.test(lines[i+1])){
        var rows=[];while(i<lines.length&&/^\s*\|.*\|\s*$/.test(lines[i])){rows.push(lines[i]);i++;}
        var cells=function(r){return r.trim().replace(/^\||\|$/g,"").split("|").map(function(c){return c.trim();});};
        var head=cells(rows[0]),body=rows.slice(2).map(cells);
        var t="<table><thead><tr>"+head.map(function(h){return "<th>"+inline(h)+"</th>";}).join("")+"</tr></thead><tbody>";
        t+=body.map(function(r){return "<tr>"+r.map(function(c){return "<td>"+inline(c)+"</td>";}).join("")+"</tr>";}).join("");
        out.push(t+"</tbody></table>");continue;
      }
      var h=l.match(/^(#{1,6})\s+(.*)$/);
      if(h){out.push("<h"+h[1].length+">"+inline(h[2])+"</h"+h[1].length+">");i++;continue;}
      if(/^\s*(-{3,}|\*{3,})\s*$/.test(l)){out.push("<hr>");i++;continue;}
      if(/^\s*>/.test(l)){var q=[];while(i<lines.length&&/^\s*>/.test(lines[i])){q.push(lines[i].replace(/^\s*>\s?/,""));i++;}out.push("<blockquote>"+md(q.join("\n"))+"</blockquote>");continue;}
      if(/^\s*([-*+]|\d+\.)\s+/.test(l)){
        var ol=/^\s*\d+\./.test(l),items=[];
        while(i<lines.length&&/^\s*([-*+]|\d+\.)\s+/.test(lines[i])){items.push(inline(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/,"")));i++;}
        out.push((ol?"<ol>":"<ul>")+items.map(function(x){return "<li>"+x+"</li>";}).join("")+(ol?"</ol>":"</ul>"));continue;
      }
      if(/^\s*$/.test(l)){i++;continue;}
      var p=[];while(i<lines.length&&!/^\s*$/.test(lines[i])&&!/^(#{1,6}\s|```|\s*>|\s*([-*+]|\d+\.)\s)/.test(lines[i])&&!/^\s*(-{3,})\s*$/.test(lines[i])){p.push(inline(lines[i]));i++;}
      out.push("<p>"+p.join("<br>")+"</p>");
    }
    return out.join("\n");
  }
  var src=document.body.dataset.md, last=null, box=document.getElementById("body"), meta=document.getElementById("meta");
  function tick(){
    fetch(src+"?t="+Date.now()).then(function(r){return r.ok?r.text():Promise.reject(r.status);})
      .then(function(t){ if(t!==last){last=t; box.innerHTML=md(t);} meta.textContent="updated "+new Date().toLocaleTimeString(); })
      .catch(function(e){ box.innerHTML='<p style="color:#a00;font-style:italic">not generated yet ('+e+') — appears automatically</p>'; meta.textContent="checked "+new Date().toLocaleTimeString(); });
  }
  tick(); setInterval(tick,4000);
})();
