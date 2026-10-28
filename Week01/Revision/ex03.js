const payments = [
    {petName: "Chester", amount: 50, status: "APPROVED"},
    {petName: "Mochi", amount: 80, status: "PENDING"},
    {petName: "Mira", amount: 40, status: "DECLINED"},

]

const mochiPayment = payments.find(payment => payment.petName === "Mochi");
if (mochiPayment) {
   console.log("Mochi's payment status: " + mochiPayment.status);
}

for (const payment of payments) {
   if (payment.status === "APPROVED") {
       console.log("Pet-care service for " + payment.petName + " confirmed");
    } else if (payment.status === "PENDING") {
        console.log("Payment for " + payment.petName + " is being processed");
    } else {
        console.log("Payment for " + payment.petName + " unsuccessful");
    }
}