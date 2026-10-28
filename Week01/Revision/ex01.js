const groomingFee = 50;
const NumberOfPets = 2;
const gstRate = 0.09;

const subtotal = groomingFee * NumberOfPets;
const gst = subtotal * gstRate;
const total = subtotal + gst;

const message = "The total cost is $" + total

console.log(message);