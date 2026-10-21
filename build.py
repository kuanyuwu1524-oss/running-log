import json,pathlib
p=pathlib.Path('/workspace/garmin/site');s=p/'src'
h=(s/'template.html').read_text()
for k,f in [('__CSS__','style.css'),('__STRUCT__','structure.js'),('__APP__','app.js')]:h=h.replace(k,(s/f).read_text())
h=h.replace('__DATA__',json.dumps(json.load(open(p/'activities.json')),ensure_ascii=False).replace('</','<\\/'))
h=h.replace('__CHARTJS__',(p/'vendor/chart.umd.min.js').read_text())
(p/'index.html').write_text(h);print(len(h))
