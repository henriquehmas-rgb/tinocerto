import 'reflect-metadata';
import { IsString, IsNotEmpty, IsInt, Min, Max, IsUUID, ValidateNested } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

class SampleDto {
  @IsUUID()
  orgUnitId!: string;

  @IsString()
  @IsNotEmpty()
  titulo!: string;

  @IsInt()
  @Min(0)
  @Max(4)
  nivelIntegridade!: number;
}

describe('class-validator + class-transformer instalados e funcionais', () => {
  it('rejeita payload com campo obrigatório ausente', async () => {
    const instance = plainToInstance(SampleDto, { orgUnitId: '3fa85f64-5717-4562-b3fc-2c963f66afa6' });
    const errors = await validate(instance);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'titulo')).toBe(true);
  });

  it('aceita payload válido', async () => {
    const instance = plainToInstance(SampleDto, {
      orgUnitId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      titulo: 'Analista Pleno',
      nivelIntegridade: 1,
    });
    const errors = await validate(instance);
    expect(errors).toHaveLength(0);
  });

  it('rejeita nivelIntegridade fora do range 0-4', async () => {
    const instance = plainToInstance(SampleDto, {
      orgUnitId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      titulo: 'Analista Pleno',
      nivelIntegridade: 7,
    });
    const errors = await validate(instance);
    expect(errors.some((e) => e.property === 'nivelIntegridade')).toBe(true);
  });
});
