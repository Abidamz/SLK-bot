//+------------------------------------------------------------------+
//| SLK_DemoReceiver.mq5                                             |
//| Demo-only signal receiver. It never submits orders.              |
//+------------------------------------------------------------------+
#property strict
#property version "0.1"

input string InpSignalEndpoint = "https://slk-alert-worker.abidogundamilola.workers.dev/signals/confirmed";
input string InpSignalApiKey = "";
input int    InpPollSeconds = 30;
input bool   InpRequireConfirmed = true;

// Deliberate hard lock: this receiver cannot trade. A separate reviewed EA
// will be required after demo soak testing and broker mapping.
const bool EXECUTION_DISABLED = true;

string seen_ids[];

int OnInit()
{
   if(!EXECUTION_DISABLED)
   {
      Print("SLK safety failure: execution lock is disabled in source");
      return INIT_FAILED;
   }
   if(StringLen(InpSignalEndpoint) == 0 || StringLen(InpSignalApiKey) == 0)
   {
      Print("SLK demo receiver: set endpoint and API key in EA inputs");
      return INIT_PARAMETERS_INCORRECT;
   }
   EventSetTimer(MathMax(10, InpPollSeconds));
   Print("SLK demo receiver started; execution is hard-disabled");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTick() {}

void OnTimer()
{
   string headers = "Authorization: Bearer " + InpSignalApiKey + "\r\n"
                  + "Accept: application/json\r\n";
   char post[], result[];
   string response_headers;
   ResetLastError();
   int status = WebRequest("GET", InpSignalEndpoint, headers, 15000, post, result, response_headers);
   if(status == -1)
   {
      PrintFormat("SLK receiver WebRequest failed: %d", GetLastError());
      return;
   }
   if(status != 200)
   {
      PrintFormat("SLK receiver HTTP %d: %s", status, CharArrayToString(result));
      return;
   }

   string body = CharArrayToString(result);
   if(StringFind(body, "\"execution\":\"DISABLED\"") < 0)
   {
      Print("SLK receiver rejected response: execution lock marker missing");
      return;
   }
   if(StringFind(body, "\"signals\":[]") >= 0)
   {
      Print("SLK receiver: no fresh confirmed signals");
      return;
   }

   // This deliberately logs the first signal only. It does not map symbols,
   // calculate volume, or send OrderSend. Signature verification and broker
   // gates belong to the reviewed demo EA that follows this receiver soak.
   string signal_id = JsonString(body, "signalId");
   string state = JsonString(body, "state");
   string symbol = JsonString(body, "symbol");
   string side = JsonString(body, "side");
   string signature = JsonString(body, "signature");
   if(InpRequireConfirmed && state != "CONFIRMED")
   {
      PrintFormat("SLK receiver rejected non-confirmed signal: %s", state);
      return;
   }
   if(StringLen(signal_id) == 0 || StringLen(signature) == 0)
   {
      Print("SLK receiver rejected signal: missing signalId or signature");
      return;
   }
   if(Seen(signal_id)) return;

   double entry = JsonNumber(body, "entry");
   double sl = JsonNumber(body, "stopLoss");
   double tp = JsonNumber(body, "takeProfit");
   string expiry = JsonString(body, "expiresAt");
   PrintFormat("SLK DEMO SIGNAL (no order): %s %s %s entry=%s SL=%s TP=%s expires=%s signature=present",
      symbol, side, signal_id, DoubleToString(entry, 8), DoubleToString(sl, 8),
      DoubleToString(tp, 8), expiry);
   Remember(signal_id);
}

bool Seen(const string id)
{
   for(int i = 0; i < ArraySize(seen_ids); i++)
      if(seen_ids[i] == id) return true;
   return false;
}

void Remember(const string id)
{
   int n = ArraySize(seen_ids);
   ArrayResize(seen_ids, n + 1);
   seen_ids[n] = id;
}

string JsonString(const string json, const string key)
{
   string needle = "\"" + key + "\":\"";
   int start = StringFind(json, needle);
   if(start < 0) return "";
   start += StringLen(needle);
   int end = StringFind(json, "\"", start);
   if(end < 0) return "";
   return StringSubstr(json, start, end - start);
}

double JsonNumber(const string json, const string key)
{
   string needle = "\"" + key + "\":";
   int start = StringFind(json, needle);
   if(start < 0) return 0.0;
   start += StringLen(needle);
   int end = start;
   while(end < StringLen(json))
   {
      ushort ch = StringGetCharacter(json, end);
      if((ch >= '0' && ch <= '9') || ch == '.' || ch == '-' || ch == '+') end++;
      else break;
   }
   return StringToDouble(StringSubstr(json, start, end - start));
}
//+------------------------------------------------------------------+
