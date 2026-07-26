import { IsNotEmpty, IsString } from 'class-validator';

export class CancelWorkflowInstanceDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
