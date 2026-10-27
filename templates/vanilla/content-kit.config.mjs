import {createContent} from '__CONTENT_EDITOR_PACKAGE__';
import {applyTextFields} from '__CONTENT_EDITOR_PACKAGE__/fields';

const definition={title:'My content',groups:{main:{label:'Main menu',parentId:null}},textFields:[
  {key:'ui.brand',label:'Header title',group:'Interface',type:'plain',initialValues:{en:'Content Kit example',sr:'Content Kit primer'}},
  {key:'ui.language',label:'Language label',group:'Interface',type:'plain',initialValues:{en:'Language',sr:'Jezik'}},
  {key:'ui.editor',label:'Editor link',group:'Interface',type:'plain',initialValues:{en:'Open editor',sr:'Otvori editor'}},
  {key:'ui.connected',label:'Live status',group:'Interface',type:'plain',initialValues:{en:'Connected to the local editor',sr:'Povezano sa lokalnim editorom'}},
  {key:'ui.static',label:'Static status',group:'Interface',type:'plain',initialValues:{en:'Static content',sr:'Statički sadržaj'}},
  {key:'ui.empty',label:'Empty content message',group:'Interface',type:'plain',initialValues:{en:'This item has no content yet.',sr:'Ova stavka još nema sadržaj.'}},
  {key:'ui.children',label:'Children-only message',group:'Interface',type:'plain',initialValues:{en:'Choose a subcategory.',sr:'Izaberite potkategoriju.'}},
  {key:'ui.select',label:'No selection message',group:'Interface',type:'plain',initialValues:{en:'Select an item.',sr:'Izaberite stavku.'}},
  {key:'ui.media',label:'Missing media message',group:'Interface',type:'plain',initialValues:{en:'Media is unavailable.',sr:'Medij nije dostupan.'}},
]};

export default {
  directory:'./content',
  siteDirectory:'./public',
  port:8012,
  definition,
  // Only seeds a new content directory. Saved editor content takes precedence.
  initialContent:applyTextFields(createContent({
    languages:[{code:'en',label:'English'},{code:'sr',label:'Srpski'}],
    nodes:[
      {id:'welcome',parentId:null,order:0,label:'welcome.label',title:'welcome.title',blocks:[{id:'welcome.body',type:'text',key:'welcome.body'}]},
      {id:'details',parentId:'welcome',order:0,label:'details.label',title:'details.title',blocks:[{id:'details.heading',type:'heading',key:'details.heading'},{id:'details.body',type:'text',key:'details.body'}]},
      {id:'about',parentId:null,order:1,label:'about.label',title:'about.title',blocks:[{id:'about.body',type:'text',key:'about.body'}]},
    ],
    texts:{
      'welcome.label':{en:'Welcome',sr:'Dobro došli'},'welcome.title':{en:'Welcome',sr:'Dobro došli'},
      'welcome.body':{en:'Open the editor and change this text. It updates here without refreshing the page.',sr:'Otvorite editor i promenite ovaj tekst. Izmene se prikazuju bez osvežavanja stranice.'},
      'details.label':{en:'Details',sr:'Detalji'},'details.title':{en:'Details',sr:'Detalji'},
      'details.heading':{en:'Your own design',sr:'Vaš dizajn'},'details.body':{en:'The module supplies content and navigation state. Your project owns HTML, CSS and animations.',sr:'Modul obezbeđuje sadržaj i stanje navigacije. Vaš projekat definiše HTML, CSS i animacije.'},
      'about.label':{en:'About',sr:'O aplikaciji'},'about.title':{en:'About this example',sr:'O ovom primeru'},
      'about.body':{en:'One Node.js process serves this site, the editor, media and live updates. Python is not required.',sr:'Jedan Node.js proces služi sajt, editor, medije i izmene uživo. Python nije potreban.'},
    },
  }),definition),
};
