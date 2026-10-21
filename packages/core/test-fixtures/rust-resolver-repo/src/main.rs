mod a;
mod b;
mod win;

use crate::a::helper;
use crate::b::child::deep;

fn main() {
    helper();
    deep();
}