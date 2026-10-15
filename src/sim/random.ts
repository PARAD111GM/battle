export class SeededRandom {
  constructor(public state = 12345) {this.state = state >>> 0 || 1;}
  next(): number { let x=this.state; x^=x<<13; x^=x>>>17; x^=x<<5; this.state=x>>>0; return this.state/4294967296; }
  range(min:number,max:number):number{return min+(max-min)*this.next();}
  pick<T>(items:readonly T[]):T{return items[Math.floor(this.next()*items.length)];}
}
