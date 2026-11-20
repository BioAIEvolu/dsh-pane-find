import {createPanel,panelCSS} from './panel.js';
import {installConversation,contribute} from './conversation.js';

window.__ModuleLoader__.load({
  id:'dsh-pane-find',
  factory(require) {
    const React=require('react'), h=React.createElement;
    return {inject:['slots'],apply(ctx){
      let panel;
      ctx.effect(()=>{
        const style=document.createElement('style');style.setAttribute('data-pane-find-ui','style');style.textContent=panelCSS;document.head.append(style);
        panel=createPanel(document);
        return ()=>{panel.dispose();style.remove();};
      },'pane-find overlay');
      contribute(ctx.get('slots'),'conversation.session.header.utilities','trigger',-10,()=>h('button',{
        type:'button',className:'pf-trigger','data-pane-find-ui':'trigger','aria-label':'页内查找',title:'页内查找',onClick:()=>panel?.open('icon')
      },h('svg',{viewBox:'0 0 20 20',width:16,height:16,fill:'none',stroke:'currentColor',strokeWidth:1.8,'aria-hidden':true},h('circle',{cx:8.2,cy:8.2,r:5.5}),h('path',{d:'m12.5 12.5 4.5 4.5',strokeLinecap:'round'}))));
      installConversation(ctx,React);
    }};
  }
});
