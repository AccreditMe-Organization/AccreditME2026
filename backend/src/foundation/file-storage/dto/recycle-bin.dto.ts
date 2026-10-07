import { ArrayMaxSize, ArrayMinSize, IsArray, IsNotEmpty, IsString } from 'class-validator';

// POST /tenant/recycle-bin/purge — 1 to 100 files, all or nothing.
export class PurgeRecycleBinDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  fileIds!: string[];
}
