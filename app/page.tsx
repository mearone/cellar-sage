import BidCapForm from "@/components/BidCapForm";

export default function Page() {
  return (
    <main className="min-h-screen flex items-start justify-center p-6" style={{ background: 'linear-gradient(135deg,#f5f5f5,#e6e6e6)' }}>
      <div className="w-full max-w-3xl">
        <h1 className="text-2xl font-bold mb-4">AI Wine Assistant — Bid-Cap Starter</h1>
        <p className="mb-6 text-sm" style={{ color: '#444' }}>
          Paste your assumptions and compute a transparent Max Bid. Edit risk/fees in <code>/config/*.yaml</code>.
        </p>
        <BidCapForm />
      </div>
    </main>
  );
}
