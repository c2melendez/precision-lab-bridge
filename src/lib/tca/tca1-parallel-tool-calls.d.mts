export type Tca1FunctionCall = {
  call_id: string;
  name: string;
  arguments: string;
};

export type Tca1FunctionCallResult = {
  call_id: string;
  ok: boolean;
  output: string;
};

export function executeParallelTca1FunctionCalls(
  functionCalls: Tca1FunctionCall[],
  invoke: (
    call: Tca1FunctionCall,
    args: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>,
): Promise<Tca1FunctionCallResult[]>;
