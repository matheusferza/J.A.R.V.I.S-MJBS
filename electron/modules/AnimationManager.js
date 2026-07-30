import { gsap } from 'gsap';
/** Applies a restrained entrance animation through GSAP. */
export class AnimationManager { constructor(){gsap.from('.panel, header, footer',{opacity:0,y:20,stagger:.08,duration:.8,ease:'power2.out'});gsap.to('.core',{scale:1.07,repeat:-1,yoyo:true,duration:1.6,ease:'sine.inOut'});} }
